const express = require('express');
const router = express.Router();

// Add new delivery address
router.post('/', (req, res) => {
  const { userId, recipient, contact, house, street, barangay, city, province, zip } = req.body;
  if (!userId || !recipient || !contact || !house || !street || !barangay || !city || !province || !zip) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }
  const sql = `
    INSERT INTO delivery_addresses 
      (user_id, recipient_name, contact_number, house_unit, street, barangay, city, province, zip_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [userId, recipient, contact, house, street, barangay, city, province, zip];
  req.db.query(sql, values, (err, result) => {
    if (err) {
      console.error('Error adding delivery address:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    req.db.query('SELECT * FROM delivery_addresses WHERE id = ?', [result.insertId], (err2, rows) => {
      if (err2) {
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      res.json(rows[0]);
    });
  });
});

// Get all addresses for a user
router.get('/', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }
  req.db.query('SELECT * FROM delivery_addresses WHERE user_id = ?', [userId], (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    res.json(results);
  });
});

module.exports = router;
