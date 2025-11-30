const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Products endpoint
router.get('/', (req, res) => {
  // Get pagination parameters
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50; // Default limit of 50 products per page
  const offset = (page - 1) * limit;
  
  // Exclude image_blob from the main products query to prevent memory overflow
  // Also include aggregated rating info from order_feedback
  const query = `
    SELECT 
      p.id,
      p.name,
      p.category,
      p.brand,
      p.volume_ml,
      p.price,
      p.stock_quantity,
      p.expiration_date,
      p.description,
      p.is_available,
      p.created_at,
      p.updated_at,
      COALESCE(AVG(f.product_rating), 0) AS average_rating,
      COUNT(f.id) AS total_reviews
    FROM products p
    LEFT JOIN order_feedback f ON f.product_id = p.id
    GROUP BY 
      p.id,
      p.name,
      p.category,
      p.brand,
      p.volume_ml,
      p.price,
      p.stock_quantity,
      p.expiration_date,
      p.description,
      p.is_available,
      p.created_at,
      p.updated_at
    ORDER BY p.id DESC
    LIMIT ? OFFSET ?`;
  
  // Get total count for pagination info
  const countQuery = 'SELECT COUNT(*) as total FROM products';
  
  req.db.query(countQuery, (err, countResults) => {
    if (err) {
      console.error('Error fetching product count:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    
    const totalProducts = countResults[0].total;
    const totalPages = Math.ceil(totalProducts / limit);
    
    req.db.query(query, [limit, offset], (err, results) => {
      if (err) {
        console.error('Error fetching products:', err);
        return res.status(500).json({ success: false, message: 'Server error' });
      }
      
      res.json({ 
        success: true, 
        products: results,
        pagination: {
          currentPage: page,
          totalPages: totalPages,
          totalProducts: totalProducts,
          limit: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      });
    });
  });
});

// Product image endpoint
router.get('/image/:id', (req, res) => {
  const { id } = req.params;
  req.db.query('SELECT image_url FROM products WHERE id = ?', [id], (err, results) => {
    if (err) {
      console.error('Error fetching product image:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    const imageUrl = results[0].image_url;
    if (!imageUrl) {
      return res.status(404).json({ success: false, message: 'Image not found' });
    }
    
    // Construct the full path to the image
    const imagePath = path.join(__dirname, '../../AcclivityAdmin/uploads', imageUrl);
    
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ success: false, message: 'Image file not found' });
    }
    
    res.sendFile(imagePath);
  });
});

// Product image from BLOB endpoint
router.get('/image/blob/:id', (req, res) => {
  const { id } = req.params;
  console.log('Fetching image blob for product ID:', id);
  
  req.db.query('SELECT image_blob, name FROM products WHERE id = ?', [id], (err, results) => {
    if (err) {
      console.error('Error fetching product image blob:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    if (results.length === 0) {
      console.log('Product not found');
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    const product = results[0];
    console.log('Product found:', product.name, 'Has blob:', !!product.image_blob, 'Blob size:', product.image_blob ? product.image_blob.length : 0);
    
    if (!product.image_blob) {
      console.log('No image blob found');
      return res.status(404).json({ success: false, message: 'Image blob not found' });
    }
    
    const imageBuffer = product.image_blob;
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(imageBuffer);
  });
});

// Test endpoint to check product image blob data
router.get('/test-image/:productId', (req, res) => {
  const { productId } = req.params;
  const query = `
    SELECT id, name, image_blob, image_url, 
           CASE WHEN image_blob IS NOT NULL THEN 'Has blob' ELSE 'No blob' END as blob_status,
           CASE WHEN image_url IS NOT NULL THEN 'Has URL' ELSE 'No URL' END as url_status
    FROM products 
    WHERE id = ?
  `;
  
  req.db.query(query, [productId], (err, results) => {
    if (err) {
      console.error('Error testing product image:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    const product = results[0];
    const response = {
      success: true,
      product: {
        id: product.id,
        name: product.name,
        blob_status: product.blob_status,
        url_status: product.url_status,
        has_blob: product.image_blob !== null,
        has_url: product.image_url !== null,
        blob_size: product.image_blob ? product.image_blob.length : 0
      }
    };
    
    res.json(response);
  });
});

// Test endpoint to get base64 image for a product
router.get('/image-base64/:productId', (req, res) => {
  const { productId } = req.params;
  const query = `SELECT id, name, image_blob, image_url FROM products WHERE id = ?`;
  
  req.db.query(query, [productId], (err, results) => {
    if (err) {
      console.error('Error fetching product image:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    const product = results[0];
    console.log('Product data:', {
      id: product.id,
      name: product.name,
      hasBlob: !!product.image_blob,
      hasUrl: !!product.image_url,
      blobType: typeof product.image_blob,
      blobLength: product.image_blob ? product.image_blob.length : 0
    });
    
    let imageData = null;
    
    if (product.image_blob) {
      try {
        const base64Image = Buffer.from(product.image_blob).toString('base64');
        imageData = {
          type: 'blob',
          base64: base64Image,
          size: base64Image.length
        };
        console.log('Successfully converted blob to base64, length:', base64Image.length);
      } catch (error) {
        console.error('Error converting blob to base64:', error);
        return res.status(500).json({ success: false, message: 'Error processing image blob' });
      }
    } else if (product.image_url) {
      imageData = {
        type: 'url',
        url: product.image_url
      };
      console.log('Using image URL:', product.image_url);
    } else {
      console.log('No image data found for product');
    }
    
    res.json({
      success: true,
      product: {
        id: product.id,
        name: product.name,
        image: imageData
      }
    });
  });
});

// Simple test endpoint to list all products with image info
router.get('/with-images', (req, res) => {
  const query = `SELECT id, name, 
                        CASE WHEN image_blob IS NOT NULL THEN 'Has blob' ELSE 'No blob' END as blob_status,
                        CASE WHEN image_url IS NOT NULL THEN 'Has URL' ELSE 'No URL' END as url_status,
                        LENGTH(image_blob) as blob_size
                 FROM products 
                 ORDER BY id`;
  
  req.db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching products with image info:', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
    
    res.json({
      success: true,
      products: results
    });
  });
});

module.exports = router;
