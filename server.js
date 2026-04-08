const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

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

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      users: [],
      requests: [],
      responses: [],
      sessions: {},
      notifications: [],
      reviews: []
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
  }
}

function readData() {
  ensureDataFile();
  const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));

  if (!raw.users) raw.users = [];
  if (!raw.requests) raw.requests = [];
  if (!raw.responses) raw.responses = [];
  if (!raw.sessions) raw.sessions = {};
  if (!raw.reviews) raw.reviews = [];

  raw.users = raw.users.map(user => ({
  ...user,
  sellerCategory: String(user.sellerCategory || '').trim(),
  notifications: Array.isArray(user.notifications) ? user.notifications : []
}));

  raw.requests = raw.requests.map(request => ({
    ...request,
    category: String(request.category || '').trim(),
    city: String(request.city || '').trim(),
    selectedSellerId: request.selectedSellerId || null,
    selectedPrice: request.selectedPrice || null,
    selectedAt: request.selectedAt || null
  }));

  return raw;
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

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
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(originalHash, 'hex')
  );
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCity(city, allowAllKazakhstan = false) {
  const normalized = String(city || '').trim();

  if (allowAllKazakhstan && normalizeText(normalized) === normalizeText(ALL_KAZAKHSTAN_LABEL)) {
    return ALL_KAZAKHSTAN_LABEL;
  }

  const found = ALLOWED_CITIES.find(item => normalizeText(item) === normalizeText(normalized));
  return found || '';
}

function isAllowedCity(city, allowAllKazakhstan = false) {
  if (allowAllKazakhstan && normalizeText(city) === normalizeText(ALL_KAZAKHSTAN_LABEL)) {
    return true;
  }
  return !!normalizeCity(city, false);
}

function ensureNotificationsArray(user) {
  if (!Array.isArray(user.notifications)) {
    user.notifications = [];
  }
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

function cleanupExpiredRequests(data) {
  const now = Date.now();

  data.requests = data.requests.map(request => {
    if (request.status === 'open' && request.expiresAt && now > request.expiresAt) {
      return {
        ...request,
        status: 'expired'
      };
    }
    return request;
  });
}

function calculateSellerRating(data, sellerId) {
  const reviews = (data.reviews || []).filter(item => item.sellerId === sellerId);

  if (!reviews.length) return null;

  const avg = reviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / reviews.length;
  return Number(avg.toFixed(1));
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }

  const data = readData();
  const session = data.sessions[token];

  if (!session) {
    return res.status(401).json({ message: 'Сессия недействительна' });
  }

  const user = data.users.find(u => u.id === session.userId);

  if (!user) {
    return res.status(401).json({ message: 'Пользователь не найден' });
  }

  req.token = token;
  req.user = user;
  req.data = data;
  next();
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

app.post('/api/register', (req, res) => {
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

  const data = readData();
  const exists = data.users.find(u => u.email === normalizedEmail);

  if (exists) {
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
  notifications: [],
  createdAt: Date.now()
};

  data.users.push(user);
  writeData(data);

  res.json({ message: 'Регистрация успешна' });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Заполни email и пароль' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const data = readData();
  const user = data.users.find(u => u.email === normalizedEmail);

  if (!user || !verifyPassword(password, user.password)) {
    return res.status(401).json({ message: 'Неверный email или пароль' });
  }

  const token = generateId('token_');

  data.sessions[token] = {
    userId: user.id,
    createdAt: Date.now()
  };

  writeData(data);

  res.json({
    message: 'Вход выполнен',
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email
    }
  });
});

app.get('/api/me', auth, (req, res) => {
  res.json({
    id: req.user.id,
    role: req.user.role,
    name: req.user.name,
    email: req.user.email,
    city: req.user.city || '',
    sellerCategory: req.user.sellerCategory || '',
    address: req.user.address || '',
    whatsapp: req.user.whatsapp || '',
    about: req.user.about || ''
  });
});

app.post('/api/logout', auth, (req, res) => {
  delete req.data.sessions[req.token];
  writeData(req.data);
  res.json({ message: 'Вы вышли из аккаунта' });
});

app.post('/api/requests', auth, upload.array('images', 6), (req, res) => {
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

  cleanupExpiredRequests(req.data);

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

  req.data.requests.unshift(requestItem);

  req.data.users
    .filter(user => user.role === 'seller')
    .forEach(seller => {
      if (canSellerSeeRequest(seller, requestItem)) {
        ensureNotificationsArray(seller);
        seller.notifications.unshift(
          createNotification(`Новая заявка: ${requestItem.title}`, 'new_request')
        );
      }
    });

  writeData(req.data);

  res.json({
    message: 'Заявка опубликована',
    request: requestItem
  });
});

app.get('/api/requests', auth, (req, res) => {
  cleanupExpiredRequests(req.data);
  writeData(req.data);

  const enriched = req.data.requests.map(request => {
    const responsesCount = req.data.responses.filter(r => r.requestId === request.id).length;
    return {
      ...request,
      responsesCount
    };
  });

  if (req.user.role === 'buyer') {
    return res.json(enriched.filter(r => r.buyerId === req.user.id));
  }

  return res.json(enriched);
});

app.get('/api/marketplace', auth, (req, res) => {
  cleanupExpiredRequests(req.data);
  writeData(req.data);

  let list = req.data.requests.map(request => {
    const responses = req.data.responses.filter(r => r.requestId === request.id);
    const hasResponded = req.user.role === 'seller'
      ? responses.some(r => r.sellerId === req.user.id)
      : false;

    return {
      ...request,
      responsesCount: responses.length,
      hasResponded
    };
  });

  if (req.user.role === 'seller') {
    list = list.filter(request =>
      request.status === 'open' &&
      canSellerSeeRequest(req.user, request) &&
      !request.hasResponded
    );
  }

  if (req.user.role === 'buyer') {
    list = list.filter(request => request.buyerId === req.user.id);
  }

  res.json(list);
});

app.post('/api/requests/:id/respond', auth, upload.array('images', 6), (req, res) => {
  if (req.user.role !== 'seller') {
    return res.status(403).json({ message: 'Только продавец может отвечать на заявки' });
  }

  const { price, message } = req.body;
  const requestId = req.params.id;

  if (!price || !message) {
    return res.status(400).json({ message: 'Укажи цену и сообщение' });
  }

  cleanupExpiredRequests(req.data);

  const request = req.data.requests.find(r => r.id === requestId);

  if (!request) {
    writeData(req.data);
    return res.status(404).json({ message: 'Заявка не найдена' });
  }

  if (request.status !== 'open') {
    writeData(req.data);
    return res.status(400).json({ message: 'На эту заявку уже нельзя ответить' });
  }

  if (!canSellerSeeRequest(req.user, request)) {
    writeData(req.data);
    return res.status(403).json({ message: 'Эта заявка недоступна для твоего города' });
  }

  const alreadyResponded = req.data.responses.find(
    r => r.requestId === requestId && r.sellerId === req.user.id
  );

  if (alreadyResponded) {
    writeData(req.data);
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

  req.data.responses.unshift(responseItem);

  const buyer = req.data.users.find(u => u.id === request.buyerId);
  if (buyer) {
    ensureNotificationsArray(buyer);
    buyer.notifications.unshift(
      createNotification(`На вашу заявку "${request.title}" пришёл новый отклик`, 'new_response')
    );
  }

  writeData(req.data);

  res.json({
    message: 'Отклик отправлен',
    response: responseItem
  });
});

app.get('/api/my-responses', auth, (req, res) => {
  if (req.user.role !== 'seller') {
    return res.status(403).json({ message: 'Только продавец может смотреть свои отклики' });
  }

  cleanupExpiredRequests(req.data);
  writeData(req.data);

  const list = req.data.responses
    .filter(response => response.sellerId === req.user.id)
    .map(response => {
      const request = req.data.requests.find(r => r.id === response.requestId);

      return {
        ...response,
        requestId: response.requestId,
        requestTitle: request ? request.title : 'Заявка удалена',
        requestCategory: request ? request.category : '',
        requestCity: request ? request.city : '',
        requestStatus: request ? request.status : 'closed',
        selectedSellerId: request ? request.selectedSellerId : null
      };
    });

  res.json(list);
});

app.get('/api/requests/:id/responses', auth, (req, res) => {
  const requestId = req.params.id;
  const request = req.data.requests.find(r => r.id === requestId);

  if (!request) {
    return res.status(404).json({ message: 'Заявка не найдена' });
  }

  if (req.user.role === 'buyer' && request.buyerId !== req.user.id) {
    return res.status(403).json({ message: 'Нет доступа' });
  }

  const responses = req.data.responses
    .filter(response => response.requestId === requestId)
    .map(response => {
      const seller = req.data.users.find(u => u.id === response.sellerId && u.role === 'seller');

      return {
        ...response,
        sellerId: response.sellerId,
        sellerWhatsapp: seller?.whatsapp || '',
        sellerCity: seller?.city || '',
        sellerRating: seller ? calculateSellerRating(req.data, seller.id) : null
      };
    });

  res.json(responses);
});

app.post('/api/requests/:id/select', auth, (req, res) => {
  if (req.user.role !== 'buyer') {
    return res.status(403).json({ message: 'Только покупатель может выбирать продавца' });
  }

  const requestId = req.params.id;
  const { sellerId } = req.body;

  const request = req.data.requests.find(r => r.id === requestId);

  if (!request) {
    return res.status(404).json({ message: 'Заявка не найдена' });
  }

  if (request.buyerId !== req.user.id) {
    return res.status(403).json({ message: 'Это не твоя заявка' });
  }

  if (request.status !== 'open') {
    return res.status(400).json({ message: 'Заявка уже закрыта' });
  }

  const response = req.data.responses.find(
    r => r.requestId === requestId && r.sellerId === sellerId
  );

  if (!response) {
    return res.status(404).json({ message: 'Отклик продавца не найден' });
  }

  request.status = 'closed';
  request.selectedSellerId = sellerId;
  request.selectedPrice = response.price;
  request.selectedAt = Date.now();

  const seller = req.data.users.find(u => u.id === sellerId);
  if (seller) {
    ensureNotificationsArray(seller);
    seller.notifications.unshift(
      createNotification(`Покупатель выбрал вас по заявке "${request.title}"`, 'deal_selected')
    );
  }

  writeData(req.data);

  res.json({
    message: 'Продавец выбран',
    request
  });
});

app.get('/api/notifications', auth, (req, res) => {
  const user = req.data.users.find(u => u.id === req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'Пользователь не найден' });
  }

  ensureNotificationsArray(user);
  res.json(user.notifications);
});

app.put('/api/notifications/read', auth, (req, res) => {
  const user = req.data.users.find(u => u.id === req.user.id);

  if (!user) {
    return res.status(404).json({ message: 'Пользователь не найден' });
  }

  ensureNotificationsArray(user);

  user.notifications = user.notifications.map(notification => ({
    ...notification,
    isRead: true
  }));

  writeData(req.data);

  res.json({ message: 'Уведомления отмечены как прочитанные' });
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

app.get('/api/sellers/:sellerId', auth, (req, res) => {
  const { sellerId } = req.params;

  const seller = req.data.users.find(user => user.id === sellerId && user.role === 'seller');

  if (!seller) {
    return res.status(404).json({ message: 'Продавец не найден' });
  }

  const sellerReviews = (req.data.reviews || [])
    .filter(review => review.sellerId === sellerId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const rating = calculateSellerRating(req.data, sellerId);

  res.json({
    id: seller.id,
    name: seller.name,
    city: seller.city || '',
    address: seller.address || '',
    whatsapp: seller.whatsapp || '',
    about: seller.about || '',
    rating,
    reviews: sellerReviews.map(review => ({
      id: review.id,
      authorName: review.authorName,
      rating: review.rating,
      text: review.text,
      createdAt: review.createdAt
    }))
  });
});

app.post('/api/sellers/:sellerId/reviews', auth, (req, res) => {
  if (req.user.role !== 'buyer') {
    return res.status(403).json({ message: 'Только покупатель может оставлять отзывы' });
  }

  const { sellerId } = req.params;
  const { rating, text } = req.body;

  const seller = req.data.users.find(user => user.id === sellerId && user.role === 'seller');

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

  req.data.reviews.unshift(reviewItem);

  ensureNotificationsArray(seller);
  seller.notifications.unshift(
    createNotification('Вам оставили новый отзыв', 'new_review')
  );

  writeData(req.data);

  res.json({
    message: 'Отзыв отправлен',
    review: reviewItem
  });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});