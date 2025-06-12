import express from 'express'
import cors from 'cors'
import axios from 'axios'
import bodyParser from 'body-parser'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(bodyParser.json())
app.use(express.static(path.join(__dirname, 'public')))

const stylePrompt = {
  default: '-style Realism',
  ghibli: '-style Ghibli Art',
  cyberpunk: '-style Cyberpunk',
  anime: '-style Anime',
  portrait: '-style Portrait',
  chibi: '-style Chibi',
  'pixel art': '-style Pixel Art',
  'oil painting': '-style Oil Painting',
  '3d': '-style 3D'
}

const sizeList = {
  '1:1': '1024x1024',
  '3:2': '1080x720',
  '2:3': '720x1080'
}

// Rate limiting object (simple in-memory store)
const rateLimiter = new Map()

// Rate limiting middleware
const rateLimit = (req, res, next) => {
  const clientIP = req.ip || req.connection.remoteAddress
  const now = Date.now()
  const windowMs = 60000 // 1 minute
  const maxRequests = 5 // max 5 requests per minute

  if (!rateLimiter.has(clientIP)) {
    rateLimiter.set(clientIP, { count: 1, resetTime: now + windowMs })
    return next()
  }

  const clientData = rateLimiter.get(clientIP)
  
  if (now > clientData.resetTime) {
    clientData.count = 1
    clientData.resetTime = now + windowMs
    return next()
  }

  if (clientData.count >= maxRequests) {
    return res.status(429).json({ 
      error: 'Terlalu banyak permintaan. Silakan tunggu sebentar.' 
    })
  }

  clientData.count++
  next()
}

// Input validation function
const validateInput = (prompt, style, size) => {
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return 'Prompt tidak boleh kosong'
  }
  
  if (prompt.length > 500) {
    return 'Prompt terlalu panjang (maksimal 500 karakter)'
  }
  
  if (!stylePrompt.hasOwnProperty(style)) {
    return 'Style tidak valid'
  }
  
  if (!sizeList.hasOwnProperty(size)) {
    return 'Ukuran tidak valid'
  }
  
  return null
}

// Generate random device ID
const generateDeviceId = () => {
  return Array.from({ length: 32 }, () => 
    Math.floor(Math.random() * 16).toString(16)
  ).join('')
}

app.post('/generate', rateLimit, async (req, res) => {
  const { prompt, style, size } = req.body

  // Validate input
  const validationError = validateInput(prompt, style, size)
  if (validationError) {
    return res.status(400).json({ error: validationError })
  }

  const headers = {
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    origin: 'https://deepimg.ai',
    referer: 'https://deepimg.ai/'
  }

  const device_id = generateDeviceId()
  const payload = {
    device_id,
    prompt: `${prompt.trim()} ${stylePrompt[style]}`,
    size: sizeList[size],
    n: '1',
    output_format: 'png'
  }

  try {
    console.log(`[${new Date().toISOString()}] Generating image for prompt: "${prompt}"`)
    
    const result = await axios.post(
      'https://api-preview.apirouter.ai/api/v1/deepimg/flux-1-dev', 
      payload, 
      { 
        headers,
        timeout: 60000 // 60 second timeout
      }
    )
    
    const imageUrl = result.data?.data?.images?.[0]?.url

    if (!imageUrl) {
      console.error('No image URL in response:', result.data)
      return res.status(500).json({ error: 'Gagal mendapatkan gambar dari server.' })
    }

    console.log(`[${new Date().toISOString()}] Image generated successfully`)
    res.json({ 
      url: imageUrl,
      metadata: {
        prompt: prompt.trim(),
        style,
        size,
        timestamp: new Date().toISOString()
      }
    })
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error generating image:`, err.message)
    
    if (err.code === 'ECONNABORTED') {
      return res.status(408).json({ error: 'Request timeout. Silakan coba lagi.' })
    }
    
    if (err.response?.status === 429) {
      return res.status(429).json({ error: 'Server sedang sibuk. Silakan coba lagi dalam beberapa saat.' })
    }
    
    if (err.response?.status >= 500) {
      return res.status(503).json({ error: 'Layanan tidak tersedia. Silakan coba lagi nanti.' })
    }
    
    res.status(500).json({ error: 'Gagal memproses permintaan. Silakan coba lagi.' })
  }
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  })
})

// Download proxy endpoint (optional - for CORS issues)
app.get('/download/:filename', async (req, res) => {
  try {
    const imageUrl = req.query.url
    if (!imageUrl) {
      return res.status(400).json({ error: 'URL gambar tidak ditemukan' })
    }

    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: 30000
    })

    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.filename}"`)
    
    response.data.pipe(res)
  } catch (error) {
    console.error('Download error:', error.message)
    res.status(500).json({ error: 'Gagal mengunduh gambar' })
  }
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' })
})

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Terjadi kesalahan server internal' })
})

app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di http://localhost:${PORT}`)
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`⏰ Started at: ${new Date().toISOString()}`)
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully')
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully')
  process.exit(0)
})
