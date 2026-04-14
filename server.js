const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const ALLOWED_CITIES = [
  'Алматы',
  'Астана',
  'Шымкент',
  'Караганда',
  'Актобе',
  'Тараз',
  'Павлодар',
  'Усть-Каменогорск',
  'Семей',
  'Костанай',
  'Кызылорда',
  'Уральск',
  'Атырау',
  'Актау',
  'Петропавловск',
  'Туркестан',
  'Кокшетау',
  'Талдыкорган',
  'Экибастуз',
  'Рудный'
];

const ALL_KAZAKHSTAN_LABEL = 'Весь Казахстан';
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  }
});

function fileFilter(req, file, cb) {
  const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowed.includes(file.mimetype)) {
    return cb(new Error('Можно загружать только JPG, PNG или WEBP'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 6
  },
  fileFilter
});

app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function generateId(prefix = '') {
  return prefix + crypto.randomBytes(8).toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
  const [salt, originalHash] = String(storedPassword || '').split(':');
  if (!salt || !originalHash) return false;

  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(originalHash, 'hex')
    );
  } catch {
    return false;
  }
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCity(city, allowAllKazakhstan = false) {
  const normalized = String(city || '').trim();

  if (
    allowAllKazakhstan &&
    normalizeText(normalized) === normalizeText(ALL_KAZAKHSTAN_LABEL)
  ) {
    return ALL_KAZAKHSTAN_LABEL;
  }

  const found = ALLOWED_CITIES.find(
    item => normalizeText(item) === normalizeText(normalized)
  );

  return found || '';
}

function isAllowedCity(city, allowAllKazakhstan = false) {
  if (
    allowAllKazakhstan &&
    normalizeText(city) === normalizeText(ALL_KAZAKHSTAN_LABEL)
  ) {
    return true;
  }
  return !!normalizeCity(city, false);
}

function createNotification(text, type = 'info') {
  return {
    id: generateId('notif_'),
    text: String(text || '').trim(),
    type,
    isRead: false,
    createdAt: Date.now()
  };
}

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      city TEXT DEFAULT '',
      seller_category TEXT DEFAULT '',
      address TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      about TEXT DEFAULT '',
      blocked BOOLEAN DEFAULT FALSE,
      created_at BIGINT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      buyer_name TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT DEFAULT '',
      city TEXT NOT NULL,
      phone TEXT NOT NULL,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'open',
      selected_seller_id TEXT,
      selected_price TEXT,
      selected_at BIGINT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      seller_name TEXT NOT NULL,
      price TEXT NOT NULL,
      message TEXT NOT NULL,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at BIGINT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      text TEXT DEFAULT '',
      created_at BIGINT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL
    )
  `);

  const adminEmail = 'admin@torg.kz';
  const existingAdmin = await db.query(
    `SELECT id FROM users WHERE role = 'admin' LIMIT 1`
  );

  if (!existingAdmin.rows.length) {
    await db.query(
      `
      INSERT INTO users (
        id, role, name, email, password, city, seller_category,
        address, whatsapp, about, blocked, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      [
        'admin_1',
        'admin',
        'Admin',
        adminEmail,
        hashPassword('123456'),
        '',
        '',
        '',
        '',
        '',
        false,
        Date.now()
      ]
    );
    console.log('Admin created: admin@torg.kz / 123456');
  }

  console.log('PostgreSQL connected');
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    email: row.email,
    city: row.city || '',
    sellerCategory: row.seller_category || '',
    address: row.address || '',
    whatsapp: row.whatsapp || '',
    about: row.about || '',
    blocked: !!row.blocked,
    createdAt: Number(row.created_at || 0)
  };
}

function mapRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name,
    title: row.title,
    description: row.description,
    category: row.category || '',
    city: row.city || '',
    phone: row.phone || '',
    images: Array.isArray(row.images) ? row.images : [],
    status: row.status,
    selectedSellerId: row.selected_seller_id || null,
    selectedPrice: row.selected_price || null,
    selectedAt: row.selected_at ? Number(row.selected_at) : null,
    createdAt: Number(row.created_at || 0),
    expiresAt: Number(row.expires_at || 0)
  };
}

function mapResponse(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestId: row.request_id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    price: row.price,
    message: row.message,
    images: Array.isArray(row.images) ? row.images : [],
    createdAt: Number(row.created_at || 0)
  };
}

function mapNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    type: row.type,
    isRead: !!row.is_read,
    createdAt: Number(row.created_at || 0)
  };
}

async function addNotification(userId, text, type = 'info') {
  const item = createNotification(text, type);
  await db.query(
    `
    INSERT INTO notifications (id, user_id, text, type, is_read, created_at)
    VALUES ($1,$2,$3,$4,$5,$6)
    `,
    [item.id, userId, item.text, item.type, item.isRead, item.createdAt]
  );
}

async function cleanupExpiredRequests() {
  const now = Date.now();
  await db.query(
    `
    UPDATE requests
    SET status = 'expired'
    WHERE status = 'open' AND expires_at < $1
    `,
    [now]
  );
}

async function calculateSellerRating(sellerId) {
  const result = await db.query(
    `
    SELECT AVG(rating)::numeric(10,1) AS avg_rating
    FROM reviews
    WHERE seller_id = $1
    `,
    [sellerId]
  );

  const value = result.rows[0]?.avg_rating;
  return value === null || value === undefined ? null : Number(value);
}

async function getUserById(userId) {
  const result = await db.query(`SELECT * FROM users WHERE id = $1 LIMIT 1`, [userId]);
  return result.rows[0] || null;
}

async function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: 'Требуется авторизация' });
    }

    const sessionResult = await db.query(
      `SELECT * FROM sessions WHERE token = $1 LIMIT 1`,
      [token]
    );
    const session = sessionResult.rows[0];

    if (!session) {
      return res.status(401).json({ message: 'Сессия недействительна' });
    }

    const user = await getUserById(session.user_id);

    if (!user) {
      return res.status(401).json({ message: 'Пользователь не найден' });
    }

    req.token = token;
    req.user = user;
    next();
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка авторизации' });
  }
}

function canSellerSeeRequest(seller, request) {
  const sellerCity = normalizeCity(seller.city);
  const requestCity = normalizeCity(request.city, true);

  const sellerCategory = normalizeText(seller.sellerCategory);
  const requestCategory = normalizeText(request.category);

  const cityMatches =
    requestCity === ALL_KAZAKHSTAN_LABEL ||
    (sellerCity && normalizeText(sellerCity) === normalizeText(requestCity));

  const categoryMatches =
    !requestCategory || (sellerCategory && sellerCategory === requestCategory);

  return cityMatches && categoryMatches;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/register', async (req, res) => {
  try {
    const {
      role,
      name,
      email,
      password,
      city,
      sellerCategory,
      address,
      whatsapp,
      about
    } = req.body;

    if (!role || !name || !email || !password) {
      return res.status(400).json({ message: 'Заполни все обязательные поля' });
    }

    if (!['buyer', 'seller'].includes(role)) {
      return res.status(400).json({ message: 'Неверная роль' });
    }

    if (role === 'seller' && !isAllowedCity(city)) {
      return res.status(400).json({ message: 'Выбери город из списка' });
    }

    if (role === 'seller' && !String(sellerCategory || '').trim()) {
      return res.status(400).json({ message: 'Выбери категорию деятельности' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedName = String(name).trim();

    if (normalizedName.length < 2) {
      return res.status(400).json({ message: 'Имя слишком короткое' });
    }

    if (String(password).trim().length < 4) {
      return res.status(400).json({ message: 'Пароль должен быть не короче 4 символов' });
    }

    const exists = await db.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );

    if (exists.rows.length) {
      return res.status(400).json({ message: 'Пользователь с таким email уже существует' });
    }

    const user = {
      id: generateId('user_'),
      role,
      name: normalizedName,
      email: normalizedEmail,
      password: hashPassword(password),
      city: role === 'seller' ? normalizeCity(city) : '',
      sellerCategory: role === 'seller' ? String(sellerCategory || '').trim() : '',
      address: role === 'seller' ? String(address || '').trim() : '',
      whatsapp: role === 'seller' ? String(whatsapp || '').trim() : '',
      about: role === 'seller' ? String(about || '').trim() : '',
      createdAt: Date.now(),
      blocked: false
    };

    await db.query(
      `
      INSERT INTO users (
        id, role, name, email, password, city, seller_category,
        address, whatsapp, about, blocked, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      [
        user.id,
        user.role,
        user.name,
        user.email,
        user.password,
        user.city,
        user.sellerCategory,
        user.address,
        user.whatsapp,
        user.about,
        user.blocked,
        user.createdAt
      ]
    );

    return res.json({ message: 'Регистрация успешна' });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Заполни email и пароль' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const result = await db.query(
      `SELECT * FROM users WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );

    const user = result.rows[0];

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ message: 'Неверный email или пароль' });
    }

    if (user.blocked) {
      return res.status(403).json({ error: 'Ваш аккаунт заблокирован' });
    }

    const token = generateId('token_');

    await db.query(
      `
      INSERT INTO sessions (token, user_id, created_at)
      VALUES ($1,$2,$3)
      `,
      [token, user.id, Date.now()]
    );

    return res.json({
      message: 'Вход выполнен',
      token,
      user: {
        id: user.id,
        role: user.role,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  return res.json({
    id: req.user.id,
    role: req.user.role,
    name: req.user.name,
    email: req.user.email,
    city: req.user.city || '',
    sellerCategory: req.user.seller_category || '',
    address: req.user.address || '',
    whatsapp: req.user.whatsapp || '',
    about: req.user.about || ''
  });
});

app.post('/api/logout', auth, async (req, res) => {
  try {
    await db.query(`DELETE FROM sessions WHERE token = $1`, [req.token]);
    return res.json({ message: 'Вы вышли из аккаунта' });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.post('/api/requests', auth, upload.array('images', 6), async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({ message: 'Только покупатель может создавать заявки' });
    }

    const { title, description, category, city, phone } = req.body;

    if (!title || !description || !city || !phone) {
      return res.status(400).json({ message: 'Заполни все поля заявки' });
    }

    if (!isAllowedCity(city, true)) {
      return res.status(400).json({ message: 'Выбери город из списка' });
    }

    await cleanupExpiredRequests();

    const requestItem = {
      id: generateId('req_'),
      buyerId: req.user.id,
      buyerName: req.user.name,
      title: String(title).trim(),
      description: String(description).trim(),
      category: String(category || '').trim(),
      city: normalizeCity(city, true),
      phone: String(phone).trim(),
      images: req.files ? req.files.map(file => '/uploads/' + file.filename) : [],
      status: 'open',
      selectedSellerId: null,
      selectedPrice: null,
      selectedAt: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    };

    await db.query(
      `
      INSERT INTO requests (
        id, buyer_id, buyer_name, title, description, category, city, phone,
        images, status, selected_seller_id, selected_price, selected_at,
        created_at, expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)
      `,
      [
        requestItem.id,
        requestItem.buyerId,
        requestItem.buyerName,
        requestItem.title,
        requestItem.description,
        requestItem.category,
        requestItem.city,
        requestItem.phone,
        JSON.stringify(requestItem.images),
        requestItem.status,
        requestItem.selectedSellerId,
        requestItem.selectedPrice,
        requestItem.selectedAt,
        requestItem.createdAt,
        requestItem.expiresAt
      ]
    );

    const sellersResult = await db.query(
      `SELECT * FROM users WHERE role = 'seller'`
    );

    for (const seller of sellersResult.rows) {
      const sellerView = {
        ...mapUser(seller)
      };

      if (canSellerSeeRequest(sellerView, requestItem)) {
        await addNotification(
          seller.id,
          `Новая заявка: ${requestItem.title}`,
          'new_request'
        );
      }
    }

    return res.json({
      message: 'Заявка опубликована',
      request: requestItem
    });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.get('/api/requests', auth, async (req, res) => {
  try {
    await cleanupExpiredRequests();

    const result = await db.query(
      `
      SELECT
        r.*,
        COUNT(resp.id)::int AS responses_count
      FROM requests r
      LEFT JOIN responses resp ON resp.request_id = r.id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      `
    );

    const enriched = result.rows.map(row => ({
      ...mapRequest(row),
      responsesCount: Number(row.responses_count || 0)
    }));

    if (req.user.role === 'buyer') {
      return res.json(enriched.filter(r => r.buyerId === req.user.id));
    }

    return res.json(enriched);
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.get('/api/marketplace', auth, async (req, res) => {
  try {
    await cleanupExpiredRequests();

    const requestsResult = await db.query(
      `
      SELECT
        r.*,
        COUNT(resp.id)::int AS responses_count
      FROM requests r
      LEFT JOIN responses resp ON resp.request_id = r.id
      GROUP BY r.id
      ORDER BY r.created_at DESC
      `
    );

    let list = [];

    for (const row of requestsResult.rows) {
      const request = mapRequest(row);

      const respondedResult = await db.query(
        `
        SELECT 1
        FROM responses
        WHERE request_id = $1 AND seller_id = $2
        LIMIT 1
        `,
        [request.id, req.user.id]
      );

      const hasResponded =
        req.user.role === 'seller' ? respondedResult.rows.length > 0 : false;

      list.push({
        ...request,
        responsesCount: Number(row.responses_count || 0),
        hasResponded
      });
    }

    if (req.user.role === 'seller') {
      const sellerView = {
        ...mapUser(req.user)
      };

      list = list.filter(request =>
        request.status === 'open' &&
        canSellerSeeRequest(sellerView, request) &&
        !request.hasResponded
      );
    }

    if (req.user.role === 'buyer') {
      list = list.filter(request => request.buyerId === req.user.id);
    }

    return res.json(list);
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.post('/api/requests/:id/respond', auth, upload.array('images', 6), async (req, res) => {
  try {
    if (req.user.role !== 'seller') {
      return res.status(403).json({ message: 'Только продавец может отвечать на заявки' });
    }

    const { price, message } = req.body;
    const requestId = req.params.id;

    if (!price || !message) {
      return res.status(400).json({ message: 'Укажи цену и сообщение' });
    }

    await cleanupExpiredRequests();

    const requestResult = await db.query(
      `SELECT * FROM requests WHERE id = $1 LIMIT 1`,
      [requestId]
    );
    const requestRow = requestResult.rows[0];

    if (!requestRow) {
      return res.status(404).json({ message: 'Заявка не найдена' });
    }

    const request = mapRequest(requestRow);
    const sellerView = {
      ...mapUser(req.user)
    };

    if (request.status !== 'open') {
      return res.status(400).json({ message: 'На эту заявку уже нельзя ответить' });
    }

    if (!canSellerSeeRequest(sellerView, request)) {
      return res.status(403).json({ message: 'Эта заявка недоступна для твоего города' });
    }

    const alreadyResponded = await db.query(
      `
      SELECT id
      FROM responses
      WHERE request_id = $1 AND seller_id = $2
      LIMIT 1
      `,
      [requestId, req.user.id]
    );

    if (alreadyResponded.rows.length) {
      return res.status(400).json({ message: 'Ты уже откликнулся на эту заявку' });
    }

    const responseItem = {
      id: generateId('resp_'),
      requestId,
      sellerId: req.user.id,
      sellerName: req.user.name,
      price: String(price).trim(),
      message: String(message).trim(),
      images: req.files ? req.files.map(file => '/uploads/' + file.filename) : [],
      createdAt: Date.now()
    };

    await db.query(
      `
      INSERT INTO responses (
        id, request_id, seller_id, seller_name, price, message, images, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
      `,
      [
        responseItem.id,
        responseItem.requestId,
        responseItem.sellerId,
        responseItem.sellerName,
        responseItem.price,
        responseItem.message,
        JSON.stringify(responseItem.images),
        responseItem.createdAt
      ]
    );

    await addNotification(
      request.buyerId,
      `На вашу заявку "${request.title}" пришёл новый отклик`,
      'new_response'
    );

    return res.json({
      message: 'Отклик отправлен',
      response: responseItem
    });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.get('/api/my-responses', auth, async (req, res) => {
  try {
    if (req.user.role !== 'seller') {
      return res.status(403).json({ message: 'Только продавец может смотреть свои отклики' });
    }

    await cleanupExpiredRequests();

    const result = await db.query(
      `
      SELECT
        resp.*,
        req.title AS request_title,
        req.category AS request_category,
        req.city AS request_city,
        req.status AS request_status,
        req.selected_seller_id
      FROM responses resp
      LEFT JOIN requests req ON req.id = resp.request_id
      WHERE resp.seller_id = $1
      ORDER BY resp.created_at DESC
      `,
      [req.user.id]
    );

    const list = result.rows.map(row => ({
      ...mapResponse(row),
      requestId: row.request_id,
      requestTitle: row.request_title || 'Заявка удалена',
      requestCategory: row.request_category || '',
      requestCity: row.request_city || '',
      requestStatus: row.request_status || 'closed',
      selectedSellerId: row.selected_seller_id || null
    }));

    return res.json(list);
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.get('/api/requests/:id/responses', auth, async (req, res) => {
  try {
    const requestId = req.params.id;

    const requestResult = await db.query(
      `SELECT * FROM requests WHERE id = $1 LIMIT 1`,
      [requestId]
    );
    const requestRow = requestResult.rows[0];

    if (!requestRow) {
      return res.status(404).json({ message: 'Заявка не найдена' });
    }

    const request = mapRequest(requestRow);

    if (req.user.role === 'buyer' && request.buyerId !== req.user.id) {
      return res.status(403).json({ message: 'Нет доступа' });
    }

    const responsesResult = await db.query(
      `
      SELECT resp.*
      FROM responses resp
      WHERE resp.request_id = $1
      ORDER BY resp.created_at DESC
      `,
      [requestId]
    );

    const responses = [];

    for (const row of responsesResult.rows) {
      const sellerResult = await db.query(
        `
        SELECT *
        FROM users
        WHERE id = $1 AND role = 'seller'
        LIMIT 1
        `,
        [row.seller_id]
      );
      const seller = sellerResult.rows[0];

      responses.push({
        ...mapResponse(row),
        sellerId: row.seller_id,
        sellerWhatsapp: seller?.whatsapp || '',
        sellerCity: seller?.city || '',
        sellerRating: seller ? await calculateSellerRating(seller.id) : null
      });
    }

    return res.json(responses);
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.post('/api/requests/:id/select', auth, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({ message: 'Только покупатель может выбирать продавца' });
    }

    const requestId = req.params.id;
    const { sellerId } = req.body;

    const requestResult = await db.query(
      `SELECT * FROM requests WHERE id = $1 LIMIT 1`,
      [requestId]
    );
    const requestRow = requestResult.rows[0];

    if (!requestRow) {
      return res.status(404).json({ message: 'Заявка не найдена' });
    }

    const request = mapRequest(requestRow);

    if (request.buyerId !== req.user.id) {
      return res.status(403).json({ message: 'Это не твоя заявка' });
    }

    if (request.status !== 'open') {
      return res.status(400).json({ message: 'Заявка уже закрыта' });
    }

    const responseResult = await db.query(
      `
      SELECT *
      FROM responses
      WHERE request_id = $1 AND seller_id = $2
      LIMIT 1
      `,
      [requestId, sellerId]
    );
    const response = responseResult.rows[0];

    if (!response) {
      return res.status(404).json({ message: 'Отклик продавца не найден' });
    }

    const selectedAt = Date.now();

    await db.query(
      `
      UPDATE requests
      SET status = 'closed',
          selected_seller_id = $1,
          selected_price = $2,
          selected_at = $3
      WHERE id = $4
      `,
      [sellerId, response.price, selectedAt, requestId]
    );

    await addNotification(
      sellerId,
      `Покупатель выбрал вас по заявке "${request.title}"`,
      'deal_selected'
    );

    const updatedRequestResult = await db.query(
      `SELECT * FROM requests WHERE id = $1 LIMIT 1`,
      [requestId]
    );

    return res.json({
      message: 'Продавец выбран',
      request: mapRequest(updatedRequestResult.rows[0])
    });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.get('/api/notifications', auth, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT *
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    return res.json(result.rows.map(mapNotification));
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.put('/api/notifications/read', auth, async (req, res) => {
  try {
    await db.query(
      `
      UPDATE notifications
      SET is_read = TRUE
      WHERE user_id = $1
      `,
      [req.user.id]
    );

    return res.json({ message: 'Уведомления отмечены как прочитанные' });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Одно фото не должно превышать 5 МБ' });
    }

    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ message: 'Можно загрузить максимум 6 фото' });
    }

    return res.status(400).json({ message: err.message || 'Ошибка загрузки файлов' });
  }

  if (err) {
    return res.status(400).json({ message: err.message || 'Ошибка сервера' });
  }

  next();
});

app.get('/api/sellers/:sellerId', auth, async (req, res) => {
  try {
    const { sellerId } = req.params;

    const sellerResult = await db.query(
      `
      SELECT *
      FROM users
      WHERE id = $1 AND role = 'seller'
      LIMIT 1
      `,
      [sellerId]
    );
    const seller = sellerResult.rows[0];

    if (!seller) {
      return res.status(404).json({ message: 'Продавец не найден' });
    }

    const reviewsResult = await db.query(
      `
      SELECT *
      FROM reviews
      WHERE seller_id = $1
      ORDER BY created_at DESC
      `,
      [sellerId]
    );

    const rating = await calculateSellerRating(sellerId);

    return res.json({
      id: seller.id,
      name: seller.name,
      city: seller.city || '',
      address: seller.address || '',
      whatsapp: seller.whatsapp || '',
      about: seller.about || '',
      rating,
      reviews: reviewsResult.rows.map(review => ({
        id: review.id,
        authorName: review.author_name,
        rating: review.rating,
        text: review.text,
        createdAt: Number(review.created_at || 0)
      }))
    });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

app.post('/api/sellers/:sellerId/reviews', auth, async (req, res) => {
  try {
    if (req.user.role !== 'buyer') {
      return res.status(403).json({ message: 'Только покупатель может оставлять отзывы' });
    }

    const { sellerId } = req.params;
    const { rating, text } = req.body;

    const sellerResult = await db.query(
      `
      SELECT *
      FROM users
      WHERE id = $1 AND role = 'seller'
      LIMIT 1
      `,
      [sellerId]
    );
    const seller = sellerResult.rows[0];

    if (!seller) {
      return res.status(404).json({ message: 'Продавец не найден' });
    }

    const numericRating = Number(rating);

    if (!numericRating || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ message: 'Оценка должна быть от 1 до 5' });
    }

    const reviewItem = {
      id: generateId('review_'),
      sellerId,
      buyerId: req.user.id,
      authorName: req.user.name,
      rating: numericRating,
      text: String(text || '').trim(),
      createdAt: Date.now()
    };

    await db.query(
      `
      INSERT INTO reviews (
        id, seller_id, buyer_id, author_name, rating, text, created_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        reviewItem.id,
        reviewItem.sellerId,
        reviewItem.buyerId,
        reviewItem.authorName,
        reviewItem.rating,
        reviewItem.text,
        reviewItem.createdAt
      ]
    );

    await addNotification(sellerId, 'Вам оставили новый отзыв', 'new_review');

    return res.json({
      message: 'Отзыв отправлен',
      review: reviewItem
    });
  } catch (error) {
    return res.status(500).json({ message: 'Ошибка сервера' });
  }
});

async function getUserFromHeader(req) {
  const userId = req.headers['x-user-id'];
  if (!userId) return null;

  const result = await db.query(
    `SELECT * FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );

  return result.rows[0] || null;
}

app.get('/api/admin/stats', async (req, res) => {
  try {
    const user = await getUserFromHeader(req);

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const usersResult = await db.query(`SELECT COUNT(*)::int AS count FROM users`);
    const requestsResult = await db.query(`SELECT COUNT(*)::int AS count FROM requests`);
    const responsesResult = await db.query(`SELECT COUNT(*)::int AS count FROM responses`);

    return res.json({
      users: usersResult.rows[0]?.count || 0,
      requests: requestsResult.rows[0]?.count || 0,
      responses: responsesResult.rows[0]?.count || 0
    });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/admin/users', async (req, res) => {
  try {
    const user = await getUserFromHeader(req);

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const result = await db.query(
      `
      SELECT id, name, email, role, blocked, city, whatsapp
      FROM users
      ORDER BY created_at DESC
      `
    );

    const safeUsers = result.rows.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      blocked: !!u.blocked,
      city: u.city || '',
      whatsapp: u.whatsapp || ''
    }));

    return res.json(safeUsers);
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const user = await getUserFromHeader(req);

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const usersResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM users`
    );

    const buyersResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE role = 'buyer'`
    );

    const sellersResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM users WHERE role = 'seller'`
    );

    const requestsResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM requests`
    );

    const responsesResult = await db.query(
      `SELECT COUNT(*)::int AS count FROM responses`
    );

    return res.json({
      users: usersResult.rows[0]?.count || 0,
      buyers: buyersResult.rows[0]?.count || 0,
      sellers: sellersResult.rows[0]?.count || 0,
      requests: requestsResult.rows[0]?.count || 0,
      responses: responsesResult.rows[0]?.count || 0
    });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.patch('/api/admin/users/:id/block', async (req, res) => {
  try {
    const admin = await getUserFromHeader(req);

    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const userResult = await db.query(
      `SELECT * FROM users WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    const targetUser = userResult.rows[0];

    if (!targetUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (targetUser.role === 'admin') {
      return res.status(400).json({ error: 'Админа блокировать нельзя' });
    }

    const newBlocked = !targetUser.blocked;

    await db.query(
      `UPDATE users SET blocked = $1 WHERE id = $2`,
      [newBlocked, req.params.id]
    );

    return res.json({
      message: newBlocked ? 'Пользователь заблокирован' : 'Пользователь разблокирован',
      user: {
        id: targetUser.id,
        blocked: newBlocked
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const admin = await getUserFromHeader(req);

    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }

    const userResult = await db.query(
      `SELECT * FROM users WHERE id = $1 LIMIT 1`,
      [req.params.id]
    );
    const targetUser = userResult.rows[0];

    if (!targetUser) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    if (targetUser.role === 'admin') {
      return res.status(400).json({ error: 'Админа удалять нельзя' });
    }

    await db.query(`DELETE FROM users WHERE id = $1`, [req.params.id]);

    return res.json({
      message: 'Пользователь удалён',
      user: {
        id: targetUser.id,
        name: targetUser.name
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ========== ЗАПУСК СЕРВЕРА ==========
initDB().then(() => {
  app.post('/api/save-push-token', (req, res) => {
  const { token, platform } = req.body || {};

  if (!token) {
    return res.status(400).json({ ok: false });
  }

  if (!req.data.pushTokens) {
    req.data.pushTokens = [];
  }

  const exists = req.data.pushTokens.find(t => t.token === token);

  if (!exists) {
    req.data.pushTokens.push({
      token,
      platform,
      createdAt: new Date()
    });

    writeData(req.data);
  }

  res.json({ ok: true });
});

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PostgreSQL connected`);
    console.log(`Server started on port ${PORT}`);
  });
}).catch(err => {
  console.error("DB error", err);
  process.exit(1);
});

// Держим процесс активным
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});