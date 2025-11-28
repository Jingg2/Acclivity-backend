const express = require('express');
const router = express.Router();

// Get points per peso conversion rate
router.get('/points-per-peso', (req, res) => {
  const query = `SELECT setting_value FROM system_settings WHERE setting_key = 'points_per_peso' LIMIT 1`;
  
  req.db.query(query, [], (err, results) => {
    if (err) {
      console.error('Error fetching points per peso:', err);
      // Return default value if error or not found
      return res.json({ success: true, pointsPerPeso: 100 });
    }
    
    const pointsPerPeso = results.length > 0 ? parseFloat(results[0].setting_value) : 100;
    res.json({ success: true, pointsPerPeso });
  });
});

// Get GCash QR image as base64 (from BLOB)
router.get('/gcash-qr-url', (req, res) => {
  const query = `SELECT image_data, mime_type, file_name 
                 FROM gcash_qr_images 
                 WHERE is_active = 1 
                 ORDER BY created_at DESC 
                 LIMIT 1`;
  
  req.db.query(query, [], (err, results) => {
    if (err) {
      console.error('Error fetching GCash QR image:', err);
      return res.json({ success: false, message: 'Failed to fetch QR image' });
    }
    
    if (results.length > 0 && results[0].image_data) {
      const imageData = results[0].image_data;
      const mimeType = results[0].mime_type || 'image/png';
      const base64Image = Buffer.from(imageData).toString('base64');
      const dataUrl = `data:${mimeType};base64,${base64Image}`;
      
      res.json({ 
        success: true, 
        gcashQrUrl: dataUrl,
        mimeType: mimeType
      });
    } else {
      res.json({ 
        success: false, 
        message: 'No GCash QR image found' 
      });
    }
  });
});

// Get conversion rate (helper function for other routes)
const getConversionRate = (db, callback) => {
  const query = `SELECT setting_value FROM system_settings WHERE setting_key = 'points_per_peso' LIMIT 1`;
  
  db.query(query, [], (err, results) => {
    if (err) {
      console.error('Error fetching conversion rate:', err);
      return callback(null, 100); // Default to 100
    }
    
    const rate = results.length > 0 ? parseFloat(results[0].setting_value) : 100;
    callback(null, rate);
  });
};

module.exports = router;
module.exports.getConversionRate = getConversionRate;

