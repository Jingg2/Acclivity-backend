const express = require('express');
const router = express.Router();
const { getConversionRate } = require('./settings');

const FEEDBACK_POINTS_DIVISOR = 50; // 1 point for every ₱50 of order total

// Submit or update feedback for an order + product
router.post('/', (req, res) => {
  const {
    userId,
    orderId,
    productId,
    productRating,
    deliveryRating,
    productFeedback = '',
    deliveryFeedback = '',
    orderTotal = 0
  } = req.body;

  if (!userId || !orderId || !productId || !productRating || !deliveryRating) {
    return res.status(400).json({
      success: false,
      message: 'User, order, product, and both ratings are required'
    });
  }

  const parsedProductRating = Math.min(Math.max(parseInt(productRating, 10) || 0, 1), 5);
  const parsedDeliveryRating = Math.min(Math.max(parseInt(deliveryRating, 10) || 0, 1), 5);
  const normalizedOrderTotal = Math.max(0, parseFloat(orderTotal) || 0);
  const calculatedPoints = Math.max(1, Math.floor(normalizedOrderTotal / FEEDBACK_POINTS_DIVISOR));

  const selectSql = `SELECT id, points_awarded FROM order_feedback WHERE order_id = ? AND product_id = ? LIMIT 1`;

  req.db.query(selectSql, [orderId, productId], (selectErr, rows) => {
    if (selectErr) {
      console.error('Error checking existing feedback:', selectErr);
      return res.status(500).json({ success: false, message: 'Failed to submit feedback' });
    }

    const saveFeedback = (alreadyAwarded, callback) => {
      if (rows && rows.length > 0) {
        const updateSql = `
          UPDATE order_feedback
          SET product_rating = ?, 
              delivery_rating = ?, 
              product_feedback = ?, 
              delivery_feedback = ?,
              updated_at = NOW()
          WHERE id = ?
        `;
        return req.db.query(updateSql, [
          parsedProductRating,
          parsedDeliveryRating,
          productFeedback,
          deliveryFeedback,
          rows[0].id
        ], (updateErr) => {
          if (updateErr) {
            console.error('Error updating feedback:', updateErr);
            return res.status(500).json({ success: false, message: 'Failed to update feedback' });
          }
          callback(alreadyAwarded);
        });
      }

      const insertSql = `
        INSERT INTO order_feedback (
          order_id,
          product_id,
          user_id,
          product_rating,
          delivery_rating,
          product_feedback,
          delivery_feedback,
          points_awarded
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      req.db.query(insertSql, [
        orderId,
        productId,
        userId,
        parsedProductRating,
        parsedDeliveryRating,
        productFeedback,
        deliveryFeedback,
        calculatedPoints
      ], (insertErr, result) => {
        if (insertErr) {
          console.error('Error saving feedback:', insertErr);
          return res.status(500).json({ success: false, message: 'Failed to submit feedback' });
        }
        rows.push({ id: result.insertId, points_awarded: calculatedPoints });
        callback(false);
      });
    };

    const awardPoints = (pointsToAward, callback) => {
      if (pointsToAward <= 0) {
        return callback();
      }

      getConversionRate(req.db, (rateErr, conversionRate) => {
        const safeConversionRate = rateErr ? 100 : conversionRate || 100;
        const description = `Feedback bonus for order #${orderId}`;
        const earningsSql = `
          INSERT INTO user_earnings (
            user_id,
            earning_type,
            points_earned,
            points_spent,
            description,
            reference_id,
            conversion_rate
          ) VALUES (?, 'order_feedback', ?, 0, ?, ?, ?)
        `;

        req.db.query(earningsSql, [
          userId,
          pointsToAward,
          description,
          orderId,
          safeConversionRate
        ], (earnErr) => {
          if (earnErr) {
            console.error('Error awarding feedback points:', earnErr);
            // Do not fail the request if points recording fails
          }
          callback();
        });
      });
    };

    if (rows && rows.length > 0) {
      const alreadyAwarded = parseFloat(rows[0].points_awarded || 0) > 0;
      return saveFeedback(alreadyAwarded, (wasAwarded) => {
        if (wasAwarded) {
          return res.json({
            success: true,
            message: 'Feedback updated. Points were already awarded for this order.',
            pointsEarned: 0,
            alreadyAwarded: true
          });
        }

        awardPoints(calculatedPoints, () => {
          const updatePointsSql = `UPDATE order_feedback SET points_awarded = ? WHERE id = ?`;
          req.db.query(updatePointsSql, [calculatedPoints, rows[0].id], () => {
            res.json({
              success: true,
              message: 'Feedback submitted and points awarded',
              pointsEarned: calculatedPoints,
              alreadyAwarded: false
            });
          });
        });
      });
    }

    // No existing row, save feedback and award immediately
    saveFeedback(false, () => {
      awardPoints(calculatedPoints, () => {
        res.json({
          success: true,
          message: 'Feedback submitted and points awarded',
          pointsEarned: calculatedPoints,
          alreadyAwarded: false
        });
      });
    });
  });
});

// Get product feedback + rating summary (path param)
router.get('/product/:productId', (req, res) => {
  const { productId } = req.params;

  if (!productId) {
    return res.status(400).json({
      success: false,
      message: 'Product ID is required'
    });
  }

  const summarySql = `
    SELECT
      COALESCE(AVG(product_rating), 0) AS averageRating,
      COUNT(*) AS totalReviews
    FROM order_feedback
    WHERE product_id = ?
  `;

  const detailsSql = `
    SELECT
      f.id,
      f.product_rating AS rating,
      f.product_feedback AS comment,
      f.created_at,
      u.name AS user_name
    FROM order_feedback f
    LEFT JOIN user_account u ON f.user_id = u.id
    WHERE f.product_id = ?
    ORDER BY f.created_at DESC
    LIMIT 100
  `;

  req.db.query(summarySql, [productId], (sumErr, sumRows) => {
    if (sumErr) {
      console.error('Error fetching rating summary:', sumErr);
      return res.status(500).json({ success: false, message: 'Failed to fetch rating summary' });
    }

    const summary = sumRows && sumRows.length > 0 ? sumRows[0] : { averageRating: 0, totalReviews: 0 };

    req.db.query(detailsSql, [productId], (detErr, detRows) => {
      if (detErr) {
        console.error('Error fetching product feedback:', detErr);
        return res.status(500).json({ success: false, message: 'Failed to fetch feedback list' });
      }

      const ratingCounts = {};
      detRows.forEach((row) => {
        const r = row.rating || 0;
        ratingCounts[r] = (ratingCounts[r] || 0) + 1;
      });

      res.json({
        success: true,
        data: {
          averageRating: parseFloat(summary.averageRating || 0),
          totalReviews: summary.totalReviews || 0,
          ratingCounts,
          reviews: detRows.map((row) => ({
            id: row.id,
            user: row.user_name || 'Anonymous',
            rating: row.rating,
            comment: row.comment || '',
            date: row.created_at
          }))
        }
      });
    });
  });
});

// Get product feedback + rating summary (query param fallback: /api/ratings/product?productId=123)
router.get('/product', (req, res) => {
  const { productId } = req.query;

  if (!productId) {
    return res.status(400).json({
      success: false,
      message: 'Product ID is required'
    });
  }

  const summarySql = `
    SELECT
      COALESCE(AVG(product_rating), 0) AS averageRating,
      COUNT(*) AS totalReviews
    FROM order_feedback
    WHERE product_id = ?
  `;

  const detailsSql = `
    SELECT
      f.id,
      f.product_rating AS rating,
      f.product_feedback AS comment,
      f.created_at,
      u.name AS user_name
    FROM order_feedback f
    LEFT JOIN user_account u ON f.user_id = u.id
    WHERE f.product_id = ?
    ORDER BY f.created_at DESC
    LIMIT 100
  `;

  req.db.query(summarySql, [productId], (sumErr, sumRows) => {
    if (sumErr) {
      console.error('Error fetching rating summary (query):', sumErr);
      return res.status(500).json({ success: false, message: 'Failed to fetch rating summary' });
    }

    const summary = sumRows && sumRows.length > 0 ? sumRows[0] : { averageRating: 0, totalReviews: 0 };

    req.db.query(detailsSql, [productId], (detErr, detRows) => {
      if (detErr) {
        console.error('Error fetching product feedback (query):', detErr);
        return res.status(500).json({ success: false, message: 'Failed to fetch feedback list' });
      }

      const ratingCounts = {};
      detRows.forEach((row) => {
        const r = row.rating || 0;
        ratingCounts[r] = (ratingCounts[r] || 0) + 1;
      });

      res.json({
        success: true,
        data: {
          averageRating: parseFloat(summary.averageRating || 0),
          totalReviews: summary.totalReviews || 0,
          ratingCounts,
          reviews: detRows.map((row) => ({
            id: row.id,
            user: row.user_name || 'Anonymous',
            rating: row.rating,
            comment: row.comment || '',
            date: row.created_at
          }))
        }
      });
    });
  });
});

module.exports = router;

