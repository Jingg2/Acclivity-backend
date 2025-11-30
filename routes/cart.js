const express = require('express');
const router = express.Router();

// Get cart items
router.get('/', (req, res) => {
  const { user_id } = req.query;
  console.log('Cart request received for user_id:', user_id);
  
  if (!user_id) {
    console.log('No user_id provided');
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }
  
  const query = `SELECT 
    c.id as cart_id, 
    c.quantity, 
    c.volume_ml, 
    c.user_id,
    c.product_id,
    p.name, 
    p.price, 
    p.image_url, 
    p.volume_ml as product_volume_ml
    FROM cart_items c 
    JOIN products p ON c.product_id = p.id 
    WHERE c.user_id = ?
    ORDER BY c.id DESC`;
  
  console.log('Executing query:', query, 'with user_id:', user_id);
  
  req.db.query(query, [user_id], (err, results) => {
    if (err) {
      console.error('Error fetching cart:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    console.log('Cart query results:', results);
    console.log('Number of cart items found:', results.length);
    res.json({ success: true, cart: results });
  });
});

// Add item to cart
router.post('/', (req, res) => {
  const { user_id, productId, quantity, volume_ml } = req.body;
  console.log('Adding to cart:', { user_id, productId, quantity, volume_ml });
  
  if (!user_id || !productId || !quantity || !volume_ml) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }
  
  // Always create a new cart item (don't check for existing items)
  req.db.query(
    'INSERT INTO cart_items (user_id, product_id, quantity, volume_ml) VALUES (?, ?, ?, ?)',
    [user_id, productId, quantity, volume_ml],
    (err, result) => {
      if (err) {
        console.error('Error adding to cart:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      console.log('Successfully added item to cart with ID:', result.insertId);
      res.json({ success: true, message: 'Added to cart', cart_item_id: result.insertId });
    }
  );
});

// Update cart item quantity
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { quantity, user_id } = req.body;
  if (!quantity || !user_id) {
    return res.status(400).json({ success: false, message: 'Quantity and user_id are required' });
  }
  req.db.query(
    'UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?',
    [quantity, id, user_id],
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      res.json({ success: true, message: 'Cart updated' });
    }
  );
});

// Remove item from cart
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }
  req.db.query(
    'DELETE FROM cart_items WHERE id = ? AND user_id = ?',
    [id, user_id],
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      res.json({ success: true, message: 'Removed from cart' });
    }
  );
});

module.exports = router;
