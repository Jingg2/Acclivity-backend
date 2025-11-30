require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, '../AcclivityAdmin/uploads')));

// Database connection pool
const db = mysql.createPool({
  host: 'centerbeam.proxy.rlwy.net',
  port: '46565',
  user: 'root',
  password: 'HZqtjFWFAoTHsFoQeRqIUUShbaVeJzth',
  database: 'railway',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  supportBigNumbers: true,
  bigNumberStrings: true,
  // Increase packet size for large BLOB data
  maxAllowedPacket: 50 * 1024 * 1024, // 50MB
  // Additional options for large data
  acquireTimeout: 60000,
  timeout: 60000
});
// Test a connection from the pool on startup
db.getConnection((err, connection) => {
  if (err) {
    console.error('Error connecting to database:', err);
  } else {
    console.log('Connected to database (pool)');
    connection.release();
  }
});

// Ensure required schema exists (run once on startup)
const ensureSchema = () => {
  // Create user_verifications table
  const createVerificationsTable = `CREATE TABLE IF NOT EXISTS user_verifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    national_id_number VARCHAR(64) NULL,
    front_image LONGBLOB NULL,
    back_image LONGBLOB NULL,
    selfie_image LONGBLOB NULL,
    front_image_path VARCHAR(255) NULL,
    back_image_path VARCHAR(255) NULL,
    selfie_image_path VARCHAR(255) NULL,
    match_score DECIMAL(5,2) NULL,
    status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    verified_at TIMESTAMP NULL,
    INDEX (user_id)
  )`;
  
  // Create user_earnings table
  const createEarningsTable = `CREATE TABLE IF NOT EXISTS user_earnings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    earning_type VARCHAR(50) NOT NULL,
    points_earned DECIMAL(10,2) DEFAULT 0,
    points_spent DECIMAL(10,2) DEFAULT 0,
    description TEXT,
    reference_id VARCHAR(100) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (user_id),
    INDEX (earning_type),
    INDEX (created_at)
  )`;
  
  // Add conversion_rate column to user_earnings if it doesn't exist
  const addConversionRateColumn = `ALTER TABLE user_earnings 
    ADD COLUMN conversion_rate DECIMAL(10,2) NULL COMMENT 'Points per peso conversion rate at the time of transaction'`;
  
  // Add GCash columns to orders table if they don't exist
  const addGcashReceiptColumn = `ALTER TABLE orders 
    ADD COLUMN gcash_receipt_url VARCHAR(500) NULL AFTER payment_status`;
  
  const addGcashRefColumn = `ALTER TABLE orders 
    ADD COLUMN gcash_ref VARCHAR(100) NULL AFTER gcash_receipt_url`;
  
  // Create user_profile table
  const createProfileTable = `CREATE TABLE IF NOT EXISTS user_profile (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    sex ENUM('male','female','other') NULL,
    birthday DATE NULL,
    age INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY (user_id)
  )`;
  
  // Create notifications table
  const createNotificationsTable = `CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('general','order','promo','delivery') NOT NULL DEFAULT 'general',
    target_audience ENUM('all','customers') NOT NULL DEFAULT 'all',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (is_active),
    INDEX (type),
    INDEX (created_at)
  )`;

  const createOrderFeedbackTable = `CREATE TABLE IF NOT EXISTS order_feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    user_id INT NOT NULL,
    product_rating TINYINT NOT NULL,
    delivery_rating TINYINT NOT NULL,
    product_feedback TEXT NULL,
    delivery_feedback TEXT NULL,
    points_awarded DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_order_product (order_id, product_id),
    INDEX (order_id),
    INDEX (product_id),
    INDEX (user_id)
  )`;

  // Create gcash_qr_images table for storing GCash QR code images as BLOB
  const createGcashQrImagesTable = `CREATE TABLE IF NOT EXISTS gcash_qr_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    image_data LONGBLOB NOT NULL COMMENT 'GCash QR code image stored as binary data',
    file_name VARCHAR(255) NULL COMMENT 'Original filename',
    mime_type VARCHAR(50) NULL COMMENT 'Image MIME type (e.g., image/png, image/jpeg)',
    file_size INT NULL COMMENT 'File size in bytes',
    is_active TINYINT(1) DEFAULT 1 COMMENT 'Whether this is the currently active QR code',
    uploaded_by INT NULL COMMENT 'User ID who uploaded the image (admin/staff)',
    description TEXT NULL COMMENT 'Optional description or notes',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_is_active (is_active),
    INDEX idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Stores GCash QR code images as BLOB for payment processing'`;

  db.query(createVerificationsTable, [], (ctErr) => {
    if (ctErr) {
      console.error('Verifications table create error:', ctErr);
      return;
    }
    
    // Add BLOB columns to existing table if they don't exist
    const addBlobColumns = `ALTER TABLE user_verifications 
      ADD COLUMN IF NOT EXISTS front_image LONGBLOB NULL,
      ADD COLUMN IF NOT EXISTS back_image LONGBLOB NULL,
      ADD COLUMN IF NOT EXISTS selfie_image LONGBLOB NULL`;
    
    db.query(addBlobColumns, [], (alterErr) => {
      if (alterErr) {
        console.error('Error adding BLOB columns:', alterErr);
      } else {
        console.log('BLOB columns added to user_verifications table');
      }
    });
    
    db.query(createEarningsTable, [], (earnErr) => {
      if (earnErr) {
        console.error('Earnings table create error:', earnErr);
        return;
      }
      
      // Add missing columns to existing user_earnings table if they don't exist
      const addEarningTypeColumn = `ALTER TABLE user_earnings ADD COLUMN earning_type VARCHAR(50) NULL AFTER user_id`;
      const addPointsEarnedColumn = `ALTER TABLE user_earnings ADD COLUMN points_earned DECIMAL(10,2) DEFAULT 0 AFTER earning_type`;
      const addPointsSpentColumn = `ALTER TABLE user_earnings ADD COLUMN points_spent DECIMAL(10,2) DEFAULT 0 AFTER points_earned`;
      const addDescriptionColumn = `ALTER TABLE user_earnings ADD COLUMN description TEXT NULL AFTER points_spent`;
      const addReferenceIdColumn = `ALTER TABLE user_earnings ADD COLUMN reference_id VARCHAR(100) NULL AFTER description`;
      
      // Add columns one by one, ignoring errors if they already exist
      db.query(addEarningTypeColumn, [], (err1) => {
        if (err1 && !err1.message.includes('Duplicate column name')) {
          console.error('Error adding earning_type column:', err1.message);
        } else if (!err1) {
          console.log('Added earning_type column to user_earnings');
        }
        
        db.query(addPointsEarnedColumn, [], (err2) => {
          if (err2 && !err2.message.includes('Duplicate column name')) {
            console.error('Error adding points_earned column:', err2.message);
          } else if (!err2) {
            console.log('Added points_earned column to user_earnings');
          }
          
          db.query(addPointsSpentColumn, [], (err3) => {
            if (err3 && !err3.message.includes('Duplicate column name')) {
              console.error('Error adding points_spent column:', err3.message);
            } else if (!err3) {
              console.log('Added points_spent column to user_earnings');
            }
            
            db.query(addDescriptionColumn, [], (err4) => {
              if (err4 && !err4.message.includes('Duplicate column name')) {
                console.error('Error adding description column:', err4.message);
              } else if (!err4) {
                console.log('Added description column to user_earnings');
              }
              
              db.query(addReferenceIdColumn, [], (err5) => {
                if (err5 && !err5.message.includes('Duplicate column name')) {
                  console.error('Error adding reference_id column:', err5.message);
                } else if (!err5) {
                  console.log('Added reference_id column to user_earnings');
                }
                
                // Migrate existing data (run each update separately)
                db.query(`UPDATE user_earnings SET points_earned = earning_amount WHERE earning_amount IS NOT NULL AND (points_earned IS NULL OR points_earned = 0)`, [], (migrateErr1) => {
                  if (migrateErr1) {
                    console.error('Error migrating earning_amount:', migrateErr1.message);
                  }
                  
                  db.query(`UPDATE user_earnings SET description = remarks WHERE remarks IS NOT NULL AND (description IS NULL OR description = '')`, [], (migrateErr2) => {
                    if (migrateErr2) {
                      console.error('Error migrating remarks:', migrateErr2.message);
                    }
                    
                    db.query(`UPDATE user_earnings SET reference_id = CAST(order_id AS CHAR) WHERE order_id IS NOT NULL AND (reference_id IS NULL OR reference_id = '')`, [], (migrateErr3) => {
                      if (migrateErr3) {
                        console.error('Error migrating order_id:', migrateErr3.message);
                      }
                      
                      db.query(`UPDATE user_earnings SET earning_type = 'purchase' WHERE earning_type IS NULL AND order_id IS NOT NULL`, [], (migrateErr4) => {
                        if (migrateErr4) {
                          console.error('Error setting earning_type:', migrateErr4.message);
                        } else {
                          console.log('Migrated existing earnings data to new structure');
                        }
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
      
      db.query(createProfileTable, [], (profErr) => {
        if (profErr) {
          console.error('Profile table create error:', profErr);
          return;
        }
        
        db.query(createNotificationsTable, [], (notifErr) => {
          if (notifErr) {
            console.error('Notifications table create error:', notifErr);
            return;
          }

          db.query(createOrderFeedbackTable, [], (feedbackErr) => {
            if (feedbackErr) {
              console.error('Order feedback table create error:', feedbackErr);
              return;
            }
            
            // Create gcash_qr_images table
            db.query(createGcashQrImagesTable, [], (gcashErr) => {
              if (gcashErr) {
                console.error('GCash QR images table create error:', gcashErr);
              } else {
                console.log('✓ gcash_qr_images table ready');
              }
            });

            console.log('All required tables created/verified');
            
            // Add missing columns to existing tables
            db.query(addConversionRateColumn, [], (convErr) => {
              if (convErr && !convErr.message.includes('Duplicate column name')) {
                console.error('Error adding conversion_rate column:', convErr.message);
              } else if (!convErr) {
                console.log('Added conversion_rate column to user_earnings');
              }
            });
            
            db.query(addGcashReceiptColumn, [], (receiptErr) => {
              if (receiptErr && !receiptErr.message.includes('Duplicate column name')) {
                console.error('Error adding gcash_receipt_url column:', receiptErr.message);
              } else if (!receiptErr) {
                console.log('Added gcash_receipt_url column to orders');
              }
              
              db.query(addGcashRefColumn, [], (refErr) => {
                if (refErr && !refErr.message.includes('Duplicate column name')) {
                  console.error('Error adding gcash_ref column:', refErr.message);
                } else if (!refErr) {
                  console.log('Added gcash_ref column to orders');
                }
                
                // Fix earning_type for purchase records
                const fixPurchaseEarnings = `UPDATE user_earnings 
                                             SET earning_type = 'purchase' 
                                             WHERE description LIKE '%Points earned from purchase%' 
                                             AND (earning_type IS NULL OR earning_type = '' OR earning_type NOT IN ('purchase', 'daily_claim', 'referral', 'admin_grant', 'points_used', 'order_bonus'))`;
                
                db.query(fixPurchaseEarnings, [], (fixErr) => {
                  if (fixErr) {
                    console.error('Error fixing purchase earnings:', fixErr.message);
                  } else {
                    // Check how many were fixed
                    db.query(`SELECT ROW_COUNT() as affected`, [], (countErr, countResult) => {
                      if (!countErr && countResult && countResult.length > 0) {
                        const affected = countResult[0].affected;
                        if (affected > 0) {
                          console.log(`Fixed ${affected} purchase earning records`);
                        }
                      }
                    });
                  }
                });
              });
            });
          });
        });
      });
    });
  });
};

ensureSchema();

// Middleware to add database connection to request object
app.use((req, res, next) => {
  req.db = db;
  next();
});

// Import routes
const authRoutes = require('./routes/auth');
const productsRoutes = require('./routes/products');
const cartRoutes = require('./routes/cart');
const favoritesRoutes = require('./routes/favorites');
const ordersRoutes = require('./routes/orders');
const deliveryAddressRoutes = require('./routes/deliveryAddress');
const earningsRoutes = require('./routes/earnings');
const profileRoutes = require('./routes/profile');
const verificationRoutes = require('./routes/verification');
const uploadRoutes = require('./routes/upload');
const notificationsRoutes = require('./routes/notifications');
const settingsRoutes = require('./routes/settings');
const ratingsRoutes = require('./routes/ratings');

// Use routes
app.use('/api', authRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/delivery-address', deliveryAddressRoutes);
app.use('/api/earnings', earningsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api', verificationRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/ratings', ratingsRoutes);


// Test route
app.get('/', (req, res) => {
  res.send('Server is live!');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Access: http://localhost:${PORT}`);
});
