const express = require('express');
const router = express.Router();

// Update user profile
router.post('/update-profile', (req, res) => {
  const { userId, name, sex, birthday, age, address } = req.body;
  
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }
  
  if (!name || !sex || !birthday || !address) {
    return res.status(400).json({ success: false, message: 'All profile fields are required' });
  }

  // Validate sex
  if (!['Male', 'Female'].includes(sex)) {
    return res.status(400).json({ success: false, message: 'Invalid sex value' });
  }

  // Validate birthday format (YYYY-MM-DD)
  const birthdayRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!birthdayRegex.test(birthday)) {
    return res.status(400).json({ success: false, message: 'Invalid birthday format. Use YYYY-MM-DD' });
  }

  // Validate age is a number
  if (isNaN(age) || age < 0 || age > 150) {
    return res.status(400).json({ success: false, message: 'Invalid age value' });
  }

  try {
    // Check if user profile exists
    req.db.query('SELECT id FROM user_profile WHERE user_id = ?', [userId], (err, results) => {
      if (err) {
        console.error('Error checking user profile:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (results.length > 0) {
        // Update existing profile
        req.db.query(
          'UPDATE user_profile SET sex = ?, birthday = ?, age = ? WHERE user_id = ?',
          [sex, birthday, age, userId],
          (err, result) => {
            if (err) {
              console.error('Error updating profile:', err);
              return res.status(500).json({ success: false, message: 'Failed to update profile' });
            }
            
            // Also update name and address in user_account table
            req.db.query(
              'UPDATE user_account SET name = ?, address = ? WHERE id = ?',
              [name, address, userId],
              (err, result) => {
                if (err) {
                  console.error('Error updating user account:', err);
                  return res.status(500).json({ success: false, message: 'Failed to update user account' });
                }
                
                res.json({ success: true, message: 'Profile updated successfully' });
              }
            );
          }
        );
      } else {
        // Create new profile
        req.db.query(
          'INSERT INTO user_profile (user_id, sex, birthday, age) VALUES (?, ?, ?, ?)',
          [userId, sex, birthday, age],
          (err, result) => {
            if (err) {
              console.error('Error creating profile:', err);
              return res.status(500).json({ success: false, message: 'Failed to create profile' });
            }
            
            // Also update name and address in user_account table
            req.db.query(
              'UPDATE user_account SET name = ?, address = ? WHERE id = ?',
              [name, address, userId],
              (err, result) => {
                if (err) {
                  console.error('Error updating user account:', err);
                  return res.status(500).json({ success: false, message: 'Failed to update user account' });
                }
                
                res.json({ success: true, message: 'Profile created successfully' });
              }
            );
          }
        );
      }
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get user profile
router.get('/get-profile/:userId', (req, res) => {
  const { userId } = req.params;
  
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  try {
    req.db.query(
      `SELECT ua.id, ua.name, ua.username, ua.contact, ua.address, ua.email,
              up.sex, up.birthday, up.age, up.profile_picture
       FROM user_account ua
       LEFT JOIN user_profile up ON ua.id = up.user_id
       WHERE ua.id = ?`,
      [userId],
      (err, results) => {
        if (err) {
          console.error('Error fetching profile:', err);
          return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (results.length === 0) {
          return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        res.json({ success: true, profile: results[0] });
      }
    );
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
