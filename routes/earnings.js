const express = require('express');
const router = express.Router();
const { getConversionRate } = require('./settings');

// Get daily claim status for a user
router.get('/daily-claim-status/:userId', (req, res) => {
  console.log('Daily claim status request for user:', req.params.userId);
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  const now = new Date();
  
  const lastClaimQuery = `SELECT created_at, description FROM user_earnings WHERE user_id = ? AND earning_type = 'daily_claim' ORDER BY created_at DESC LIMIT 1`;
  
  req.db.query(lastClaimQuery, [userId], (err2, lastResults) => {
    if (err2) {
      console.error('Error getting last claim:', err2);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    
    let weeklyStreak = 0;
    let lastClaimDate = null;
    let canClaim = true;
    
    if (lastResults.length > 0) {
      lastClaimDate = new Date(lastResults[0].created_at);
      const match = lastResults[0].description.match(/Day (\d+)/);
      if (match) {
        weeklyStreak = parseInt(match[1]);
      }
      
      // Check if 24 hours have passed since last claim
      const hoursSinceLastClaim = (now - lastClaimDate) / (1000 * 60 * 60);
      
      if (hoursSinceLastClaim < 24) {
        // Less than 24 hours - cannot claim yet
        canClaim = false;
      } else if (hoursSinceLastClaim >= 24 && hoursSinceLastClaim < 48) {
        // Between 24-48 hours - can claim, continue streak
        canClaim = true;
        // Streak continues (will be incremented in frontend)
      } else {
        // More than 48 hours - reset streak to 0 (will become day 1 on next claim)
        canClaim = true;
        weeklyStreak = 0; // Reset streak
      }
    } else {
      // No previous claims - can claim, start at day 1
      canClaim = true;
      weeklyStreak = 0;
    }
    
    res.json({
      success: true,
      canClaim: canClaim,
      lastClaimDate: lastClaimDate ? lastClaimDate.toISOString() : null,
      weeklyStreak: weeklyStreak,
      hoursSinceLastClaim: lastClaimDate ? (now - lastClaimDate) / (1000 * 60 * 60) : null
    });
  });
});

// Record daily claim
router.post('/daily-claim', (req, res) => {
  console.log('Daily claim request received:', req.body);
  
  const { userId, pointsEarned, weeklyStreak } = req.body;
  
  if (!userId || !pointsEarned || weeklyStreak === undefined) {
    console.log('Missing required fields:', { userId, pointsEarned, weeklyStreak });
    return res.status(400).json({ success: false, message: 'User ID, points earned, and weekly streak are required' });
  }

  const description = `Daily login bonus - Day ${weeklyStreak}`;

  // Get conversion rate and store it with the earning
  getConversionRate(req.db, (err, conversionRate) => {
    if (err) {
      console.error('Error getting conversion rate:', err);
      conversionRate = 100; // Default fallback
    }
    
    console.log(`[DAILY CLAIM] Using conversion rate: ${conversionRate} for user ${userId}`);
    
    const query = `INSERT INTO user_earnings (user_id, earning_type, points_earned, points_spent, description, reference_id, conversion_rate) VALUES (?, 'daily_claim', ?, 0, ?, NULL, ?)`;

    console.log('Executing query:', query);
    console.log('Query parameters:', [userId, pointsEarned, description, conversionRate]);

    req.db.query(query, [userId, pointsEarned, description, conversionRate], (err, result) => {
      if (err) {
        console.error('Error recording daily claim:', err);
        console.error('Error details:', err.message, err.code);
        return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
      }
      console.log(`[DAILY CLAIM] Successfully recorded earning ID ${result.insertId} with conversion_rate: ${conversionRate}`);
      res.json({ success: true, earningId: result.insertId, conversion_rate: conversionRate });
    });
  });
});

// Get user earnings history
router.get('/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  const query = `SELECT id, earning_type, points_earned, points_spent, description, reference_id, created_at FROM user_earnings WHERE user_id = ? ORDER BY created_at DESC`;

  req.db.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching user earnings:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    res.json({ success: true, earnings: results });
  });
});

// Add earning transaction
router.post('/', (req, res) => {
  const { userId, earningType, pointsEarned, pointsSpent, description, referenceId } = req.body;
  
  if (!userId || !earningType) {
    return res.status(400).json({ success: false, message: 'User ID and earning type are required' });
  }

  // Get conversion rate and store it with the earning
  getConversionRate(req.db, (err, conversionRate) => {
    if (err) {
      console.error('Error getting conversion rate:', err);
      conversionRate = 100; // Default fallback
    }
    
    console.log(`[EARNINGS] Using conversion rate: ${conversionRate} for user ${userId}, type: ${earningType}`);
    
    const query = `INSERT INTO user_earnings (user_id, earning_type, points_earned, points_spent, description, reference_id, conversion_rate) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    console.log('Executing query:', query);
    console.log('Query parameters:', [userId, earningType, pointsEarned || 0, pointsSpent || 0, description, referenceId, conversionRate]);

    req.db.query(query, [userId, earningType, pointsEarned || 0, pointsSpent || 0, description, referenceId, conversionRate], (err, result) => {
      if (err) {
        console.error('Error adding earning:', err);
        console.error('Error details:', err.message, err.code);
        return res.status(500).json({ success: false, message: 'Server error: ' + err.message });
      }
      console.log(`[EARNINGS] Successfully recorded earning ID ${result.insertId} with conversion_rate: ${conversionRate}`);
      res.json({ success: true, earningId: result.insertId, conversion_rate: conversionRate });
    });
  });
});

// Get points balance for a user
router.get('/points-balance/:userId', (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'User ID is required' });
  }

  // Get balance directly from database - sum all points_earned and points_spent
  const query = `SELECT 
    IFNULL(SUM(points_earned), 0) as total_earned,
    IFNULL(SUM(points_spent), 0) as total_spent,
    IFNULL(SUM(points_earned), 0) - IFNULL(SUM(points_spent), 0) as current_balance
    FROM user_earnings 
    WHERE user_id = ?`;

  req.db.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching points balance:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    
    if (!results || results.length === 0) {
      return res.json({ 
        success: true, 
        balance: { total_earned: 0, total_spent: 0, current_balance: 0 } 
      });
    }
    
    // Get raw values from database
    const totalEarned = parseFloat(results[0].total_earned) || 0;
    const totalSpent = parseFloat(results[0].total_spent) || 0;
    const currentBalance = totalEarned - totalSpent;
    
    const balance = {
      total_earned: totalEarned,
      total_spent: totalSpent,
      current_balance: currentBalance
    };
    
    console.log(`[BALANCE] User ${userId} - Earned: ${balance.total_earned}, Spent: ${balance.total_spent}, Balance: ${balance.current_balance}`);
    
    // Debug: Get all earnings for this user
    req.db.query(`SELECT id, earning_type, points_earned, points_spent FROM user_earnings WHERE user_id = ?`, [userId], (debugErr, debugResults) => {
      if (!debugErr && debugResults) {
        console.log(`[BALANCE DEBUG] User ${userId} has ${debugResults.length} earnings records:`, debugResults);
      }
    });
    
    res.json({ success: true, balance });
  });
});

// Fix purchase earning types (one-time fix)
router.post('/fix-purchase-types', (req, res) => {
  const fixQuery = `UPDATE user_earnings 
                    SET earning_type = 'purchase' 
                    WHERE description LIKE '%Points earned from purchase%' 
                    AND (earning_type IS NULL OR earning_type = '' OR earning_type NOT IN ('purchase', 'daily_claim', 'referral', 'admin_grant', 'points_used', 'order_bonus'))`;
  
  req.db.query(fixQuery, [], (err, result) => {
    if (err) {
      console.error('Error fixing purchase earnings:', err);
      return res.status(500).json({ success: false, message: 'Failed to fix records: ' + err.message });
    }
    
    const affectedRows = result.affectedRows || 0;
    console.log(`Fixed ${affectedRows} purchase earning records`);
    
    res.json({ 
      success: true, 
      message: `Fixed ${affectedRows} purchase earning records`,
      affected_rows: affectedRows
    });
  });
});

module.exports = router;