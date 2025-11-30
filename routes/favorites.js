const express = require('express');
const router = express.Router();

// Get favorites
router.get('/', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }
  req.db.query(
    'SELECT f.*, p.* FROM favorites f JOIN products p ON f.product_id = p.id WHERE f.user_id = ?',
    [user_id],
    (err, results) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      res.json({ success: true, favorites: results });
    }
  );
});

// Add to favorites
router.post('/', (req, res) => {
  const { user_id, productId } = req.body;
  if (!user_id || !productId) {
    return res.status(400).json({ success: false, message: 'User ID and product ID are required' });
  }
  req.db.query(
    'INSERT INTO favorites (user_id, product_id) VALUES (?, ?)',
    [user_id, productId],
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      res.json({ success: true, message: 'Added to favorites' });
    }
  );
});

// Remove from favorites
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }
  req.db.query(
    'DELETE FROM favorites WHERE id = ? AND user_id = ?',
    [id, user_id],
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      res.json({ success: true, message: 'Removed from favorites' });
    }
  );
});

module.exports = router;
