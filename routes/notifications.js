const express = require('express');
const router = express.Router();

// Get all active notifications for mobile app
router.get('/', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const sql = `SELECT id, title, message, type, target_audience, created_at 
                 FROM notifications 
                 WHERE is_active = 1 
                 ORDER BY created_at DESC 
                 LIMIT ?`;
    
    req.db.query(sql, [limit], (err, results) => {
      if (err) {
        console.error('Error fetching notifications:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to fetch notifications',
          error: err.message 
        });
      }
      
      // Format the results for the mobile app
      const formattedNotifications = results.map(notification => ({
        id: notification.id,
        title: notification.title,
        message: notification.message,
        type: notification.type || 'general',
        timestamp: notification.created_at,
        target_audience: notification.target_audience || 'all'
      }));
      
      res.json({
        success: true,
        notifications: formattedNotifications
      });
    });
  } catch (error) {
    console.error('Error in notifications route:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Create notification (admin only - can be called from admin panel)
router.post('/', (req, res) => {
  try {
    const { title, message, type = 'general', target_audience = 'all' } = req.body;
    
    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Title and message are required'
      });
    }
    
    const sql = `INSERT INTO notifications (title, message, type, target_audience, is_active, created_at, updated_at) 
                 VALUES (?, ?, ?, ?, 1, NOW(), NOW())`;
    
    req.db.query(sql, [title, message, type, target_audience], (err, result) => {
      if (err) {
        console.error('Error creating notification:', err);
        return res.status(500).json({
          success: false,
          message: 'Failed to create notification',
          error: err.message
        });
      }
      
      res.json({
        success: true,
        message: 'Notification created successfully',
        notification_id: result.insertId
      });
    });
  } catch (error) {
    console.error('Error in create notification route:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

module.exports = router;

