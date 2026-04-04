const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      users: [],
      requests: [],
      responses: [],
      sessions: {}
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
  }
}

function readData() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
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
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/register', (req, res) => {
  const { role, name, email, password } = req.body;

  if (!role || !name || !email || !password) {
    return res.status(400).json({ message: 'Заполни все поля' });
  }

  if (!['buyer', 'seller'].includes(role)) {
    return res.status(400).json({ message: 'Неверная роль' });
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
    email: req.user.email
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

  const requestItem = {
    id: generateId('req_'),
    buyerId: req.user.id,
    buyerName: req.user.name,
    title: String(title).trim(),
    carModel: String(carModel).trim(),
    partName: String(partName).trim(),
    description: String(description).trim(),
    city: String(city).trim(),
    phone: String(phone).trim(),
    status: 'open',
    createdAt: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  };

  req.data.requests.unshift(requestItem);
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

  const requests = req.data.requests.map(requestItem => {
    const responses = req.data.responses.filter(r => r.requestId === requestItem.id);
    return {
      ...requestItem,
      responsesCount: responses.length
    };
  });

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

  const requestItem = req.data.requests.find(r => r.id === requestId);
  if (!requestItem) {
    return res.status(404).json({ message: 'Заявка не найдена' });
  }

  if (requestItem.status !== 'open') {
    return res.status(400).json({ message: 'На эту заявку уже нельзя ответить' });
  }

  const alreadyResponded = req.data.responses.find(
    r => r.requestId === requestId && r.sellerId === req.user.id
  );

  if (alreadyResponded) {
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

  const responses = req.data.responses.filter(r => r.requestId === requestId);
  res.json(responses);
});

app.get('/api/my-responses', auth, (req, res) => {
  if (req.user.role !== 'seller') {
    return res.status(403).json({ message: 'Только продавец может смотреть свои ответы' });
  }

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

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});