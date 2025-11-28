const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();

const client = new OAuth2Client('233364202198-dnvgicchqsin6ni5as4nlsle7jktaiq1.apps.googleusercontent.com');

// Get salt endpoint
router.post('/getsalt', (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ success: false, message: 'Username is required' });
  }
  req.db.query('SELECT salt FROM user_account WHERE username = ?', [username], (err, results) => {
    if (err) {
      console.error('Error fetching salt:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    if (results.length === 0) {
      return res.status(400).json({ success: false, message: 'Username not found' });
    }
    res.json({ success: true, salt: results[0].salt });
  });
});

// Email verification endpoint using Abstract API
router.post('/verify-email', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  // Basic email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email format' });
  }

  try {
    // First check if email already exists in our database
    req.db.query('SELECT * FROM user_account WHERE email = ?', [email], async (err, results) => {
      if (err) {
        console.error('Error checking email:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      
      if (results.length > 0) {
        return res.status(400).json({ success: false, message: 'Email already registered' });
      }

      // For now, just allow Gmail addresses (we'll add Google OAuth verification later)
      if (email.endsWith('@gmail.com')) {
        res.json({ 
          success: true, 
          message: 'Gmail address accepted',
          email: email
        });
      } else {
        res.status(400).json({ 
          success: false, 
          message: 'Only Gmail addresses are allowed for now.' 
        });
      }
    });
  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({ success: false, message: 'Email verification failed' });
  }
});

// Register endpoint
router.post('/register', async (req, res) => {
  const { name, username, contact, address, email, hashedPassword, salt, role = 'customer' } = req.body;
  console.log('Register request body:', req.body);
  if (!name || !username || !contact || !address || !email || !hashedPassword || !salt) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }
  
  // Validate username format
  const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
  if (!usernameRegex.test(username)) {
    return res.status(400).json({ success: false, message: 'Username must be 3-20 characters and contain only letters, numbers, and underscores' });
  }
  
    // Check if username already exists
    req.db.query('SELECT * FROM user_account WHERE username = ?', [username], (err, usernameResults) => {
    if (err) {
      console.error('Error checking username:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    if (usernameResults.length > 0) {
      return res.status(400).json({ success: false, message: 'Username already taken' });
    }
    
                // Check if contact number already exists
                req.db.query('SELECT * FROM user_account WHERE contact = ?', [contact], (err, contactResults) => {
      if (err) {
        console.error('Error checking contact:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      if (contactResults.length > 0) {
        return res.status(400).json({ success: false, message: 'Contact number already registered' });
      }

      // Email is required: validate and ensure uniqueness
      const normalizedEmail = String(email).trim();

      const insertUser = () => {
        // Use a single transaction so user is not created if verification fails
        req.db.getConnection((connErr, connection) => {
          if (connErr) {
            console.error('DB connection error (pool):', connErr);
            return res.status(500).json({ success: false, message: 'Server error' });
          }
          // Set packet size for this connection
          connection.query('SET SESSION sql_mode = "NO_AUTO_VALUE_ON_ZERO"', (err) => {
            if (err) console.error('Error setting SQL mode:', err);
          });
          const rollbackAndRespond = (statusCode, message, cleanupFiles = []) => {
            connection.rollback(() => {
              connection.release();
              // try to cleanup any files written before error
              try {
                const fs = require('fs');
                cleanupFiles.forEach((p) => { if (p && fs.existsSync(p)) { fs.unlinkSync(p); } });
              } catch (_) {}
              return res.status(statusCode).json({ success: false, message });
            });
          };
          connection.beginTransaction((btErr) => {
            if (btErr) {
              connection.release();
              console.error('Transaction begin error:', btErr);
              return res.status(500).json({ success: false, message: 'Server error' });
            }
            connection.query(
              'INSERT INTO user_account (name, username, contact, address, email, password, salt, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [name, username, contact, address, normalizedEmail, hashedPassword, salt, role || 'customer'],
              (userErr, userResult) => {
                if (userErr) {
                  console.error('Error creating user:', userErr);
                  return rollbackAndRespond(500, 'Server error');
                }
                const newUserId = userResult.insertId;
                connection.query('INSERT INTO user_profile (user_id) VALUES (?)', [newUserId], (profErr) => {
                  if (profErr) {
                    console.error('Insert profile error:', profErr);
                    return rollbackAndRespond(500, 'Server error');
                  }
                  connection.commit((cmErr) => {
                    if (cmErr) {
                      console.error('Commit error:', cmErr);
                      return rollbackAndRespond(500, 'Server error');
                    }
                    connection.release();
                    return res.json({ success: true, userId: newUserId, username, contact, role: role || 'customer' });
                  });
                });
              }
            );
          });
        });
      };

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({ success: false, message: 'Invalid email format' });
      }
      // Ensure email is unique
      req.db.query('SELECT id FROM user_account WHERE email = ?', [normalizedEmail], (err, emailResults) => {
        if (err) {
          console.error('Error checking email:', err);
          return res.status(500).json({ success: false, message: 'Server error' });
        }
        if (emailResults.length > 0) {
          return res.status(400).json({ success: false, message: 'Email already registered' });
        }
        insertUser();
      });
    });
  });
});

// Login endpoint
router.post('/login', (req, res) => {
  const { username, hashedPassword } = req.body;
  console.log('Login attempt for username:', username);
  
  if (!username || !hashedPassword) {
    console.log('Login failed: Missing fields');
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }
  
  req.db.query('SELECT * FROM user_account WHERE username = ?', [username], (err, results) => {
    if (err) {
      console.error('Database error during login:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    
    if (results.length === 0) {
      console.log('Login failed: User not found');
      return res.status(400).json({ success: false, message: 'User not found' });
    }
    
    const user = results[0];
    console.log('User found, checking password...');
    
    if (user.password !== hashedPassword) {
      console.log('Login failed: Invalid password');
      return res.status(400).json({ success: false, message: 'Invalid credentials' });
    }
    
    console.log('Login successful for user:', username);
    
    // Determine verification status
    const statusSql = 'SELECT status FROM user_verifications WHERE user_id = ? ORDER BY id DESC LIMIT 1';
    req.db.query(statusSql, [user.id], (verr, vrows) => {
      const verificationStatus = (!verr && vrows && vrows.length > 0) ? vrows[0].status : 'none';
      res.json({ success: true, username, user_id: user.id, name: user.name, verification_status: verificationStatus });
    });
  });
});

// Change password endpoint
router.post('/change-password', (req, res) => {
  const { userId, currentPasswordHash, newPasswordHash, newSalt } = req.body;

  if (!userId || !currentPasswordHash || !newPasswordHash || !newSalt) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  req.db.query('SELECT password FROM user_account WHERE id = ?', [userId], (err, results) => {
    if (err) {
      console.error('Database error during password change:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { password: storedHash } = results[0];
    if (storedHash !== currentPasswordHash) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    req.db.query(
      'UPDATE user_account SET password = ?, salt = ? WHERE id = ?',
      [newPasswordHash, newSalt, userId],
      (updateErr) => {
        if (updateErr) {
          console.error('Error updating password:', updateErr);
          return res.status(500).json({ success: false, message: 'Failed to update password' });
        }

        res.json({ success: true, message: 'Password updated successfully' });
      }
    );
  });
});

// Google OAuth callback endpoint (like PHP approach)
router.get('/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).send('Authorization code not found');
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: '233364202198-dnvgicchqsin6ni5as4nlsle7jktaiq1.apps.googleusercontent.com',
        client_secret: 'GOCSPX-Jgvdz7_ZXnn_maBarmY1TxZFg7Z',
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: 'http://localhost:3000/api/auth/google/callback'
      })
    });

    const tokenData = await tokenResponse.json();
    
    if (!tokenData.access_token) {
      return res.status(400).send('Failed to get access token');
    }

    // Get user info from Google
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });

    const userData = await userResponse.json();
    
    if (!userData.email) {
      return res.status(400).send('Failed to get user info');
    }

    // Return success page with user data
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Login Successful</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .success { color: green; font-size: 24px; }
          .info { margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="success">✅ Login Successful!</div>
        <div class="info">Welcome, ${userData.name}!</div>
        <div class="info">Email: ${userData.email}</div>
        <script>
          // Send data back to React Native app
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              success: true,
              email: '${userData.email}',
              name: '${userData.name}',
              picture: '${userData.picture}',
              googleId: '${userData.id}'
            }));
          }
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).send('OAuth error occurred');
  }
});

module.exports = router;
