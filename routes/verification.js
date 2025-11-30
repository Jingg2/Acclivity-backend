const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Ensure verification table exists
function ensureVerificationTable(db) {
	const createSql = `
		CREATE TABLE IF NOT EXISTS user_verifications (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			national_id_number VARCHAR(64) NULL,
			front_image_path VARCHAR(255) NULL,
			selfie_image_path VARCHAR(255) NULL,
			match_score DECIMAL(5,2) NULL,
			status ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
			notes TEXT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			verified_at TIMESTAMP NULL,
			INDEX (user_id)
		);
	`;
	return new Promise((resolve) => {
		db.query(createSql, [], () => resolve());
	});
}

// Safe ALTERs in case table exists without new columns
function ensureNewColumns(db) {
    const alters = [
        "ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS selfie_image_path VARCHAR(255) NULL",
        "ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS match_score DECIMAL(5,2) NULL",
        "ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS back_image_path VARCHAR(255) NULL",
        "ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS front_image LONGBLOB NULL",
        "ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS back_image LONGBLOB NULL",
        "ALTER TABLE user_verifications ADD COLUMN IF NOT EXISTS selfie_image LONGBLOB NULL"
    ];
	return Promise.all(alters.map(sql => new Promise((resolve) => db.query(sql, [], () => resolve()))));
}

// Convert base64 data URL or raw base64 into a Buffer
function base64ToBuffer(base64String) {
    try {
        if (!base64String) return null;
        const matches = String(base64String).match(/^data:(.+);base64,(.+)$/);
        const data = matches ? matches[2] : base64String;
        return Buffer.from(data, 'base64');
    } catch (e) {
        return null;
    }
}

// Submit verification
router.post('/verification/submit', async (req, res) => {
    const { user_id, nationalIdNumber, frontImageBase64, backImageBase64, selfieImageBase64 } = req.body || {};
	if (!user_id) {
		return res.status(400).json({ success: false, message: 'user_id is required' });
	}
	if (!frontImageBase64 || !backImageBase64 || !selfieImageBase64) {
		return res.status(400).json({ success: false, message: 'Front ID image, back ID image, and selfie are required' });
	}
	await ensureVerificationTable(req.db);
    await ensureNewColumns(req.db);
    const frontImageBuffer = base64ToBuffer(frontImageBase64);
    const backImageBuffer = base64ToBuffer(backImageBase64);
    const selfieImageBuffer = base64ToBuffer(selfieImageBase64);
    // If both images present, try face matching with AWS Rekognition if env configured
    let matchScore = null;
    let status = 'pending';
    try {
        if (frontImageBuffer && selfieImageBuffer && process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            const { RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition');
            const client = new RekognitionClient({ region: process.env.AWS_REGION });
            const sourceBytes = frontImageBuffer;
            const targetBytes = selfieImageBuffer;
            const cmd = new CompareFacesCommand({ SourceImage: { Bytes: sourceBytes }, TargetImage: { Bytes: targetBytes }, SimilarityThreshold: 0 });
            const out = await client.send(cmd);
            const best = (out.FaceMatches || []).reduce((m, f) => Math.max(m, f.Similarity || 0), 0);
            matchScore = Number(best.toFixed(2));
            const threshold = Number(process.env.FACE_MATCH_THRESHOLD || 85);
            status = matchScore >= threshold ? 'verified' : 'rejected';
        }
    } catch (e) {
        console.error('Face match error:', e);
        // keep status pending if face match failed to run
        status = 'pending';
    }

    const insertSql = `
        INSERT INTO user_verifications (user_id, national_id_number, front_image, back_image, selfie_image, match_score, status, verified_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, IF(? = 'verified', NOW(), NULL))
    `;
    req.db.query(insertSql, [user_id, nationalIdNumber || null, frontImageBuffer, backImageBuffer, selfieImageBuffer, matchScore, status, status], (err) => {
        if (err) {
            console.error('verification submit error:', err);
            return res.status(500).json({ success: false, message: 'Server error' });
        }
        return res.json({ success: true, message: 'Verification processed', status, match_score: matchScore });
    });
});

// Get verification status
router.get('/verification/status', async (req, res) => {
	const userId = req.query.user_id;
	if (!userId) {
		return res.status(400).json({ success: false, message: 'user_id is required' });
	}
	await ensureVerificationTable(req.db);
    const sql = `
        SELECT status, national_id_number, front_image_path, selfie_image_path, match_score, verified_at, updated_at
		FROM user_verifications
		WHERE user_id = ?
		ORDER BY id DESC
		LIMIT 1
	`;
	req.db.query(sql, [userId], (err, rows) => {
		if (err) {
			console.error('verification status error:', err);
			return res.status(500).json({ success: false, message: 'Server error' });
		}
		if (!rows || rows.length === 0) {
			return res.json({ success: true, status: 'none' });
		}
        const row = rows[0];
        return res.json({ success: true, status: row.status, national_id_number: row.national_id_number, front_image_path: row.front_image_path, selfie_image_path: row.selfie_image_path, match_score: row.match_score, verified_at: row.verified_at, updated_at: row.updated_at });
	});
});

module.exports = router;


