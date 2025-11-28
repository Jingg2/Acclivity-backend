const express = require('express');
const router = express.Router();
const { getConversionRate } = require('./settings');

// Place new order
router.post('/', (req, res) => {
  const {
    userId,
    totalAmount,
    deliveryAddressId,
    orderStatus = 'pending',
    paymentMethod = 'Cash on Delivery', 
    paymentStatus = 'unpaid',
    gcashRef = null,
    gcashReceiptUrl = null,
    orderDate,
    deliveryDate = null,
    notes = ''
  } = req.body;

  console.log('Creating order with data:', {
    userId,
    totalAmount,
    deliveryAddressId,
    orderStatus,
    paymentMethod,
    paymentStatus,
    gcashRef,
    gcashReceiptUrl,
    orderDate,
    deliveryDate,
    notes
  });

  if (!userId || !totalAmount || !deliveryAddressId || !orderStatus || !paymentMethod || !paymentStatus || !orderDate) {
    console.error('Missing required fields:', { userId, totalAmount, deliveryAddressId, orderStatus, paymentMethod, paymentStatus, orderDate });
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  // Check if user is verified before allowing order placement
  const verificationCheckSql = 'SELECT status FROM user_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1';
  req.db.query(verificationCheckSql, [userId], (verr, vrows) => {
    if (verr) {
      console.error('Error checking verification status:', verr);
      return res.status(500).json({ success: false, message: 'Error checking verification status' });
    }

    const verificationStatus = (!vrows || vrows.length === 0) ? 'none' : vrows[0].status;
    
    if (verificationStatus !== 'verified') {
      console.log(`Order blocked: User ${userId} is not verified (status: ${verificationStatus})`);
      return res.status(403).json({ 
        success: false, 
        message: 'Account verification required. Please verify your account before placing an order.',
        verificationStatus: verificationStatus
      });
    }

    // User is verified, proceed with order creation
    const sql = `
    INSERT INTO orders (
      user_id, total_amount, delivery_address_id, order_status, payment_method, payment_status, gcash_ref, gcash_receipt_url, order_date, delivery_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    userId,
    totalAmount,
    deliveryAddressId,
    orderStatus,
    paymentMethod,
    paymentStatus,
    gcashRef,
    gcashReceiptUrl,
    orderDate,
    deliveryDate,
    notes
  ];

  console.log('Executing SQL:', sql, 'with values:', values);

  req.db.query(sql, values, (err, result) => {
    if (err) {
      console.error('Error creating order:', err);
      return res.status(500).json({ success: false, message: 'Failed to create order: ' + err.message });
    }
    console.log('Order created successfully with ID:', result.insertId);
    
    // Get conversion rate for storing with the record
    getConversionRate(req.db, (err, conversionRate) => {
      if (err) {
        console.error('Error getting conversion rate:', err);
        conversionRate = 100; // Default fallback
      }
      
      // Calculate points earned: 1 point for every 20 pesos
      // Example: 100 pesos = 5 points, 200 pesos = 10 points
      const pointsEarned = Math.floor(totalAmount / 20);
      
      const earningsQuery = `
        INSERT INTO user_earnings (user_id, earning_type, points_earned, points_spent, description, reference_id, conversion_rate)
        VALUES (?, 'purchase', ?, 0, 'Points earned from purchase', ?, ?)
      `;
      
      console.log(`[ORDER] Recording earnings: ${pointsEarned} points for ₱${totalAmount} purchase (1 point per 20 pesos)`);
      console.log('Earnings query:', earningsQuery);
      console.log('Earnings parameters:', [userId, pointsEarned, result.insertId, conversionRate]);
      
      req.db.query(earningsQuery, [userId, pointsEarned, result.insertId, conversionRate], (earnErr) => {
        if (earnErr) {
          console.error('Error recording earnings:', earnErr);
          console.error('Error details:', earnErr.message, earnErr.code);
          // Don't fail the order if earnings recording fails
        } else {
          console.log(`[ORDER] Successfully recorded ${pointsEarned} points for user ${userId} from ₱${totalAmount} purchase`);
        }
      });
      
      res.json({
        success: true,
        message: 'Order placed successfully',
        order_id: result.insertId,
        total_amount: totalAmount,
        points_earned: pointsEarned,
        conversion_rate: conversionRate,
        points_calculation: '1 point per 20 pesos'
      });
    });
  }); // End of order creation query callback
  }); // End of verification check callback
});

// Get scheduled deliveries for a user (orders that have delivery records)
router.get('/scheduled-deliveries', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }
  
  console.log('Fetching scheduled deliveries for user:', userId);
  
  // Get orders that have delivery records (scheduled for delivery)
  // First get all orders with delivery records for this user
  const scheduledQuery = `
    SELECT DISTINCT
      o.order_id,
      o.user_id,
      o.total_amount,
      o.order_date,
      o.order_status,
      o.payment_method,
      o.payment_status,
      o.delivery_address_id,
      o.delivery_date,
      o.notes,
      da.recipient_name,
      da.contact_number,
      da.house_unit,
      da.street,
      da.barangay,
      da.city,
      da.province,
      da.zip_code,
      do.delivery_status,
      do.assigned_driver,
      do.delivery_notes,
      do.delivery_date as scheduled_delivery_date
    FROM orders o
    LEFT JOIN delivery_addresses da ON o.delivery_address_id = da.id
    INNER JOIN delivery_orders do ON o.order_id = do.order_id
    WHERE o.user_id = ? AND (o.order_status = 'out_for_delivery' OR o.order_status = 'to_ship')
    ORDER BY o.order_date DESC
  `;
  
  req.db.query(scheduledQuery, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching scheduled deliveries:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    
    console.log(`Found ${results.length} scheduled delivery orders for user ${userId}`);
    console.log('Sample delivery data:', results.length > 0 ? {
      order_id: results[0].order_id,
      assigned_driver: results[0].assigned_driver,
      scheduled_delivery_date: results[0].scheduled_delivery_date,
      delivery_notes: results[0].delivery_notes
    } : 'No results');
    
    // Now get order items for each order
    if (results.length === 0) {
      return res.json([]);
    }
    
    const orderIds = results.map(row => row.order_id);
    const placeholders = orderIds.map(() => '?').join(',');
    
    const itemsQuery = `
      SELECT 
        oi.item_id,
        oi.order_id,
        oi.product_id,
        oi.quantity,
        oi.price,
        p.name as product_name,
        p.volume_ml,
        p.category,
        p.description,
        p.image_blob as product_image_blob,
        p.image_url as product_image_url,
        p.price as product_price
          FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id IN (${placeholders})
      ORDER BY oi.order_id, oi.item_id
        `;
      
    req.db.query(itemsQuery, orderIds, (err2, items) => {
        if (err2) {
          console.error('Error fetching order items:', err2);
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      
      // Group items by order_id
      const itemsMap = {};
      items.forEach(item => {
        if (!itemsMap[item.order_id]) {
          itemsMap[item.order_id] = [];
        }
        
        // Convert image blob to base64 if it exists
          if (item.product_image_blob) {
            const base64Image = Buffer.from(item.product_image_blob).toString('base64');
          item.product_image_blob = base64Image;
        }
        
        itemsMap[item.order_id].push(item);
      });
      
      // Combine orders with their items
      const orders = results.map(row => ({
        id: row.order_id,
        order_id: row.order_id,
        user_id: row.user_id,
        total_amount: row.total_amount,
        order_date: row.order_date,
        order_status: row.order_status,
        payment_method: row.payment_method,
        payment_status: row.payment_status,
        delivery_address_id: row.delivery_address_id,
        delivery_date: row.delivery_date,
        notes: row.notes,
        recipient_name: row.recipient_name,
        recipient_contact: row.contact_number,
        delivery_address: `${row.house_unit || ''}, ${row.street || ''}, ${row.barangay || ''}, ${row.city || ''}, ${row.province || ''} ${row.zip_code || ''}`.replace(/,\s*,/g, ',').replace(/^,\s*|,\s*$/g, ''),
        delivery_status: row.delivery_status,
        assigned_driver: row.assigned_driver,
        delivery_notes: row.delivery_notes,
        scheduled_delivery_date: row.scheduled_delivery_date,
        order_items: itemsMap[row.order_id] || []
      }));
      
      console.log(`Returning ${orders.length} scheduled delivery orders with items`);
      orders.forEach(order => {
        console.log(`Order ${order.order_id}: driver=${order.assigned_driver}, scheduled=${order.scheduled_delivery_date}, items=${order.order_items.length}`);
      });
      
      res.json(orders);
    });
  });
});

// Get all orders for a user with product details using order_items as main table
router.get('/', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }
  
  console.log('Fetching orders for user:', userId);
  
  // Use order_items as the main table and JOIN with orders, products, and delivery_orders
  const mainQuery = `
    SELECT 
      oi.item_id,
      oi.order_id,
      oi.product_id,
      oi.quantity,
      oi.price,
      o.order_id as order_id_main,
      o.user_id,
      o.total_amount,
      o.order_date,
      o.order_status,
      o.payment_method,
      o.payment_status,
      o.delivery_address_id,
      o.delivery_date,
      o.notes,
      da.recipient_name,
      da.contact_number,
      da.house_unit,
      da.street,
      da.barangay,
      da.city,
      da.province,
      da.zip_code,
      p.name as product_name,
      p.volume_ml,
      p.category,
      p.description,
      p.image_blob as product_image_blob,
      p.image_url as product_image_url,
      p.price as product_price,
      do.assigned_driver,
      do.delivery_notes,
      do.delivery_date as scheduled_delivery_date,
      do.delivery_status
    FROM order_items oi
    LEFT JOIN orders o ON oi.order_id = o.order_id
    LEFT JOIN delivery_addresses da ON o.delivery_address_id = da.id
    LEFT JOIN products p ON oi.product_id = p.id
    LEFT JOIN delivery_orders do ON o.order_id = do.order_id
    WHERE o.user_id = ?
    ORDER BY o.order_date DESC, oi.item_id ASC
  `;
  
  req.db.query(mainQuery, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching order items with joins:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    
    console.log(`Found ${results.length} order items for user ${userId}`);
    
    // Group results by order_id to create the expected structure
    const ordersMap = {};
    
    results.forEach((row) => {
      const orderId = row.order_id;
      
      // If this order doesn't exist in our map, create it
      if (!ordersMap[orderId]) {
        ordersMap[orderId] = {
          id: row.order_id_main,
          order_id: row.order_id_main,
          user_id: row.user_id,
          total_amount: row.total_amount,
          order_date: row.order_date,
          order_status: row.order_status,
          payment_method: row.payment_method,
          payment_status: row.payment_status,
          delivery_address_id: row.delivery_address_id,
          delivery_date: row.delivery_date,
          notes: row.notes,
          recipient_name: row.recipient_name,
          recipient_contact: row.contact_number,
          delivery_address: `${row.house_unit}, ${row.street}, ${row.barangay}, ${row.city}, ${row.province} ${row.zip_code}`,
          assigned_driver: row.assigned_driver,
          delivery_notes: row.delivery_notes,
          scheduled_delivery_date: row.scheduled_delivery_date,
          delivery_status: row.delivery_status,
          order_items: []
        };
      }
      
      // Add the order item with product details
      const orderItem = {
        item_id: row.item_id,
        order_id: row.order_id,
        product_id: row.product_id,
        quantity: row.quantity,
        price: row.price,
        product_name: row.product_name,
        volume_ml: row.volume_ml,
        category: row.category,
        description: row.description,
        product_image_blob: row.product_image_blob,
        product_image_url: row.product_image_url,
        product_price: row.product_price
      };
      
      // Convert image blob to base64 if it exists
      if (row.product_image_blob) {
        console.log(`Converting image blob for product ${row.product_id}, size: ${row.product_image_blob.length}`);
        const base64Image = Buffer.from(row.product_image_blob).toString('base64');
        orderItem.product_image_blob = base64Image;
        console.log(`Converted to base64, length: ${base64Image.length}`);
      }
      
      ordersMap[orderId].order_items.push(orderItem);
    });
    
    // Convert map to array
    const orders = Object.values(ordersMap);
    
    console.log(`Grouped into ${orders.length} orders`);
    orders.forEach(order => {
      console.log(`Order ${order.order_id} has ${order.order_items.length} items`);
    });
    
    res.json(orders);
  });
});

// Add order item to order_items table
router.post('/items', (req, res) => {
  const { order_id, product_id, quantity, price } = req.body;
  console.log('Creating order item:', { order_id, product_id, quantity, price });
  
  const qty = Number(quantity);
  const linePrice = Number(price);

  if (!order_id || !product_id || !qty || !linePrice) {
    console.error('Missing required fields:', { order_id, product_id, quantity, price });
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }
  if (qty <= 0) {
    return res.status(400).json({ success: false, message: 'Quantity must be greater than zero' });
  }

  req.db.getConnection((connErr, connection) => {
    if (connErr) {
      console.error('Error getting DB connection:', connErr);
      return res.status(500).json({ success: false, message: 'Database connection error' });
    }

    const rollback = (status = 500, message = 'Server error') => {
      connection.rollback(() => {
        connection.release();
        res.status(status).json({ success: false, message });
      });
    };

    connection.beginTransaction((txErr) => {
      if (txErr) {
        console.error('Transaction error:', txErr);
        connection.release();
        return res.status(500).json({ success: false, message: 'Failed to start transaction' });
      }

      // First check current stock
      connection.query('SELECT stock_quantity FROM products WHERE id = ?', [product_id], (checkErr, checkResult) => {
        if (checkErr) {
          console.error('Error checking stock:', checkErr);
          return rollback(500, 'Failed to check product stock');
        }

        if (checkResult.length === 0) {
          console.warn(`Product ${product_id} not found`);
          return rollback(404, 'Product not found');
        }

        const currentStock = checkResult[0].stock_quantity;
        console.log(`[STOCK] Product ${product_id} current stock: ${currentStock}, requested: ${qty}`);

        if (currentStock < qty) {
          console.warn(`[STOCK] Insufficient stock for product ${product_id}. Current: ${currentStock}, Requested: ${qty}`);
          return rollback(400, `Insufficient stock. Available: ${currentStock}, Requested: ${qty}`);
        }

        // Decrement stock
        const decrementSql = `
          UPDATE products
          SET stock_quantity = stock_quantity - ?
          WHERE id = ? AND stock_quantity >= ?
        `;

        connection.query(decrementSql, [qty, product_id, qty], (decErr, decResult) => {
          if (decErr) {
            console.error('Error decrementing stock:', decErr);
            return rollback(500, 'Failed to update product stock');
          }

          if (decResult.affectedRows === 0) {
            console.warn(`[STOCK] Stock update failed for product ${product_id}. Requested ${qty}`);
            return rollback(400, 'Insufficient stock for this product');
          }

          // Verify the update
          connection.query('SELECT stock_quantity FROM products WHERE id = ?', [product_id], (verifyErr, verifyResult) => {
            if (verifyErr) {
              console.error('Error verifying stock update:', verifyErr);
            } else {
              const newStock = verifyResult[0].stock_quantity;
              console.log(`[STOCK] Product ${product_id} stock updated: ${currentStock} -> ${newStock} (decremented by ${qty})`);
            }

            // Insert order item
            const insertSql = `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)`;
            connection.query(insertSql, [order_id, product_id, qty, linePrice], (insErr, result) => {
              if (insErr) {
                console.error('Error inserting order item:', insErr);
                return rollback(500, 'Failed to insert order item');
              }

              connection.commit((commitErr) => {
                if (commitErr) {
                  console.error('Commit error:', commitErr);
                  return rollback(500, 'Failed to finalize order item');
                }

                connection.release();
                console.log('Order item created successfully with ID:', result.insertId);
                res.json({
                  success: true,
                  message: 'Order item added and stock updated',
                  order_item_id: result.insertId,
                });
              });
            });
          });
        });
      });
    });
  });
});

module.exports = router;
