const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
      reviews: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
  }
}

function normalizeText(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cityKey(city) {
  return normalizeText(city);
}

function isAllKazakhstan(city) {
  return cityKey(city) === cityKey(ALL_KAZAKHSTAN_LABEL);
}

function findCanonicalCity(city) {
  const key = cityKey(city);
  return ALLOWED_CITIES.find(item => cityKey(item) === key) || null;
}

function normalizeStoredCity(city, allowAllKazakhstan = false) {
  if (allowAllKazakhstan && isAllKazakhstan(city)) {
    return ALL_KAZAKHSTAN_LABEL;
  }

  return findCanonicalCity(city) || '';
}

function citiesMatch(cityA, cityB) {
  return cityKey(cityA) === cityKey(cityB);
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
    city: user.role === 'seller' ? normalizeStoredCity(user.city) : (user.city || ''),
    notifications: Array.isArray(user.notifications) ? user.notifications : []
  }));

  raw.requests = raw.requests.map(requestItem => ({
    ...requestItem,
    city: normalizeStoredCity(requestItem.city, true)
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
  const [salt, originalHash] = storedPassword.split(':');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(originalHash, 'hex')
  );
}

function isAllowedCity(city, allowAllKazakhstan = false) {
  if (allowAllKazakhstan && isAllKazakhstan(city)) {
    return true;
  }

  return !!findCanonicalCity(city);
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

  req.user = user;
  req.token = token;
  req.data = data;
  next();
}

function cleanupExpiredRequests(data) {
  const now = Date.now();
  data.requests = data.requests.map(r => {
    if (r.status === 'open' && r.expiresAt && now > r.expiresAt) {
      return { ...r, status: 'expired' };
    }
    return r;
  });
}

function calculateSellerRating(data, sellerId) {
  const sellerReviews = (data.reviews || []).filter(r => r.sellerId === sellerId);

  if (!sellerReviews.length) return null;

  const avg =
    sellerReviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) /
    sellerReviews.length;

  return Number(avg.toFixed(1));
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

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedName = String(name).trim();

  if (normalizedName.length < 2) {
    return res.status(400).json({ message: 'Имя слишком короткое' });
  }

  if (password.length < 4) {
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
    city: role === 'seller' ? normalizeStoredCity(city) : '',
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

  if (!user) {
    return res.status(401).json({ message: 'Неверный email или пароль' });
  }

  if (!verifyPassword(password, user.password)) {
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

app.post('/api/requests', auth, (req, res) => {
  if (req.user.role !== 'buyer') {
    return res.status(403).json({ message: 'Только покупатель может создавать заявки' });
  }

  const { title, carModel, partName, description, city, phone } = req.body;

  if (!title || !carModel || !partName || !description || !city || !phone) {
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
    carModel: String(carModel).trim(),
    partName: String(partName).trim(),
    description: String(description).trim(),
    city: normalizeStoredCity(city, true),
    phone: String(phone).trim(),
    status: 'open',
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  };

  req.data.requests.unshift(requestItem);

  const sellers = req.data.users.filter(user => user.role === 'seller');
  sellers.forEach(seller => {
    const sellerCity = normalizeStoredCity(seller.city);
    const requestCity = normalizeStoredCity(requestItem.city, true);

    const canSeeRequest =
      requestCity === ALL_KAZAKHSTAN_LABEL ||
      (sellerCity && citiesMatch(requestCity, sellerCity));

    if (canSeeRequest) {
      ensureNotificationsArray(seller);
      seller.notifications.unshift(
        createNotification(`Новая заявка: ${requestItem.title}`, 'new_request')
      );
    }
  });

  writeData(req.data);

  res.json({ message: 'Заявка опубликована', request: requestItem });
});

app.get('/api/requests', auth, (req, res) => {
  cleanupExpiredRequests(req.data);

  const enriched = req.data.requests.map(requestItem => {
    const responses = req.data.responses.filter(r => r.requestId === requestItem.id);
    return {
      ...requestItem,
      responsesCount: responses.length
    };
  });

  writeData(req.data);

  if (req.user.role === 'seller') {
    return res.json(enriched);
  }

  const buyerRequests = enriched.filter(r => r.buyerId === req.user.id);
  res.json(buyerRequests);
});

app.get('/api/marketplace', auth, (req, res) => {
  cleanupExpiredRequests(req.data);
  writeData(req.data);

  let requests = req.data.requests.map(requestItem => {
    const responses = req.data.responses.filter(r => r.requestId === requestItem.id);

    const hasResponded = req.user.role === 'seller'
      ? responses.some(r => r.sellerId === req.user.id)
      : false;

    return {
      ...requestItem,
      responsesCount: responses.length,
      hasResponded
    };
  });

  if (req.user.role === 'seller') {
    const sellerCity = normalizeStoredCity(req.user.city);

    requests = requests.filter(requestItem => {
      const requestCity = normalizeStoredCity(requestItem.city, true);

      const matchesCity =
        requestCity === ALL_KAZAKHSTAN_LABEL ||
        (sellerCity && citiesMatch(requestCity, sellerCity));

      return matchesCity && !requestItem.hasResponded;
    });
  }

  res.json(requests);
});

app.post('/api/requests/:id/respond', auth, (req, res) => {
  if (req.user.role !== 'seller') {
    return res.status(403).json({ message: 'Только продавец может отвечать на заявки' });
  }

  const { message, price } = req.body;
  const requestId = req.params.id;

  if (!message || !price) {
    return res.status(400).json({ message: 'Укажи сообщение и цену' });
  }

  cleanupExpiredRequests(req.data);

  const requestItem = req.data.requests.find(r => r.id === requestId);
  if (!requestItem) {
    writeData(req.data);
    return res.status(404).json({ message: 'Заявка не найдена' });
  }

  if (requestItem.status !== 'open') {
    writeData(req.data);
    return res.status(400).json({ message: 'На эту заявку уже нельзя ответить' });
  }

  const sellerCity = normalizeStoredCity(req.user.city);
  const requestCity = normalizeStoredCity(requestItem.city, true);

  const canSeeRequest =
    requestCity === ALL_KAZAKHSTAN_LABEL ||
    (sellerCity && citiesMatch(requestCity, sellerCity));

  if (!canSeeRequest) {
    writeData(req.data);
    return res.status(403).json({ message: 'Эта заявка недоступна для твоего города' });
  }

  const alreadyResponded = req.data.responses.find(
    r => r.requestId === requestId && r.sellerId === req.user.id
  );

  if (alreadyResponded) {
    writeData(req.data);
    return res.status(400).json({ message: 'Ты уже отвечал на эту заявку' });
  }

  const responseItem = {
    id: generateId('resp_'),
    requestId,
    sellerId: req.user.id,
    sellerName: req.user.name,
    message: String(message).trim(),
    price: String(price).trim(),
    createdAt: Date.now()
  };

  req.data.responses.unshift(responseItem);

  const buyer = req.data.users.find(u => u.id === requestItem.buyerId);
  if (buyer) {
    ensureNotificationsArray(buyer);
    buyer.notifications.unshift(
      createNotification(`На вашу заявку "${requestItem.title}" пришёл новый ответ`, 'new_response')
    );
  }

  writeData(req.data);

  res.json({ message: 'Ответ отправлен', response: responseItem });
});

app.get('/api/requests/:id/responses', auth, (req, res) => {
  const requestId = req.params.id;
  const requestItem = req.data.requests.find(r => r.id === requestId);

  if (!requestItem) {
    return res.status(404).json({ message: 'Заявка не найдена' });
  }

  if (req.user.role === 'buyer' && requestItem.buyerId !== req.user.id) {
    return res.status(403).json({ message: 'Нет доступа' });
  }

  const responses = req.data.responses
    .filter(r => r.requestId === requestId)
    .map(response => ({
      ...response,
      sellerId: response.sellerId
    }));

  res.json(responses);
});

app.get('/api/my-responses', auth, (req, res) => {
  if (req.user.role !== 'seller') {
    return res.status(403).json({ message: 'Только продавец может смотреть свои ответы' });
  }

  cleanupExpiredRequests(req.data);
  writeData(req.data);

  const myResponses = req.data.responses
    .filter(r => r.sellerId === req.user.id)
    .map(response => {
      const requestItem = req.data.requests.find(r => r.id === response.requestId);
      return {
        ...response,
        requestTitle: requestItem ? requestItem.title : 'Заявка удалена',
        requestPartName: requestItem ? requestItem.partName : '',
        requestCarModel: requestItem ? requestItem.carModel : ''
      };
    });

  res.json(myResponses);
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

app.get('/api/sellers/:sellerId', auth, (req, res) => {
  const { sellerId } = req.params;

  const seller = req.data.users.find(
    u => u.id === sellerId && u.role === 'seller'
  );

  if (!seller) {
    return res.status(404).json({ message: 'Продавец не найден' });
  }

  const sellerReviews = (req.data.reviews || [])
    .filter(r => r.sellerId === sellerId)
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
    reviews: sellerReviews.map(r => ({
      id: r.id,
      author: r.authorName,
      rating: r.rating,
      text: r.text,
      createdAt: r.createdAt
    }))
  });
});

app.post('/api/sellers/:sellerId/reviews', auth, (req, res) => {
  if (req.user.role !== 'buyer') {
    return res.status(403).json({ message: 'Только покупатель может оставлять отзывы' });
  }

  const { sellerId } = req.params;
  const { rating, text } = req.body;

  const seller = req.data.users.find(
    u => u.id === sellerId && u.role === 'seller'
  );

  if (!seller) {
    return res.status(404).json({ message: 'Продавец не найден' });
  }

  const numericRating = Number(rating);

  if (!numericRating || numericRating < 1 || numericRating > 5) {
    return res.status(400).json({ message: 'Оценка должна быть от 1 до 5' });
  }

  const reviewItem = {
    id: generateId('rev_'),
    sellerId,
    buyerId: req.user.id,
    authorName: req.user.name,
    rating: numericRating,
    text: String(text || '').trim(),
    createdAt: Date.now()
  };

  req.data.reviews.unshift(reviewItem);
  writeData(req.data);

  res.json({ message: 'Отзыв добавлен', review: reviewItem });
});

app.put('/api/profile', auth, (req, res) => {
  const { name, city, address, whatsapp, about } = req.body;

  const userIndex = req.data.users.findIndex(u => u.id === req.user.id);

  if (userIndex === -1) {
    return res.status(404).json({ message: 'Пользователь не найден' });
  }

  if (name && String(name).trim().length < 2) {
    return res.status(400).json({ message: 'Имя слишком короткое' });
  }

  if (req.user.role === 'seller' && city !== undefined && !isAllowedCity(city)) {
    return res.status(400).json({ message: 'Выбери город из списка' });
  }

  req.data.users[userIndex] = {
    ...req.data.users[userIndex],
    name: name !== undefined ? String(name).trim() : req.data.users[userIndex].name,
    city: city !== undefined ? normalizeStoredCity(city) : req.data.users[userIndex].city,
    address: address !== undefined ? String(address).trim() : req.data.users[userIndex].address,
    whatsapp: whatsapp !== undefined ? String(whatsapp).trim() : req.data.users[userIndex].whatsapp,
    about: about !== undefined ? String(about).trim() : req.data.users[userIndex].about
  };

  writeData(req.data);

  res.json({
    message: 'Профиль обновлён',
    user: {
      id: req.data.users[userIndex].id,
      role: req.data.users[userIndex].role,
      name: req.data.users[userIndex].name,
      email: req.data.users[userIndex].email,
      city: req.data.users[userIndex].city || '',
      address: req.data.users[userIndex].address || '',
      whatsapp: req.data.users[userIndex].whatsapp || '',
      about: req.data.users[userIndex].about || ''
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});