const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.', { index: false }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

const db = new sqlite3.Database('/tmp/database.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к БД:', err.message);
  } else {
    console.log('База данных подключена');
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      part TEXT NOT NULL,
      status TEXT DEFAULT 'Новая заявка'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL
    )
  `);
});

app.post('/submit', (req, res) => {
  const { name, phone, part } = req.body;

  if (!name || !phone || !part) {
    return res.send('Заполни все поля');
  }

  db.run(
    'INSERT INTO requests (name, phone, part, status) VALUES (?, ?, ?, ?)',
    [name, phone, part, 'Новая заявка'],
    function (err) {
      if (err) {
        console.error('Ошибка сохранения:', err.message);
        return res.send('Ошибка при сохранении');
      }

      res.send(`Заявка сохранена. ID: ${this.lastID}`);
    }
  );
});

app.post('/seller-register', (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.json({ success: false, message: 'Заполни все поля' });
  }

  db.run(
    'INSERT INTO sellers (login, password) VALUES (?, ?)',
    [login, password],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.json({ success: false, message: 'Такой логин уже существует' });
        }

        console.error('Ошибка регистрации:', err.message);
        return res.json({ success: false, message: 'Ошибка регистрации' });
      }

      res.json({ success: true, message: 'Регистрация прошла успешно' });
    }
  );
});

app.post('/seller-login', (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.json({ success: false, message: 'Заполни все поля' });
  }

  db.get(
    'SELECT * FROM sellers WHERE login = ? AND password = ?',
    [login, password],
    (err, row) => {
      if (err) {
        console.error('Ошибка входа:', err.message);
        return res.json({ success: false, message: 'Ошибка входа' });
      }

      if (!row) {
        return res.json({ success: false, message: 'Неверный логин или пароль' });
      }

      res.json({ success: true, login: row.login });
    }
  );
});

app.get('/requests', (req, res) => {
  db.all('SELECT * FROM requests ORDER BY id DESC', [], (err, rows) => {
    if (err) {
      console.error('Ошибка получения данных:', err.message);
      return res.status(500).send('Ошибка получения данных');
    }

    res.json(rows);
  });
});

app.post('/respond/:id', (req, res) => {
  const id = req.params.id;

  db.run(
    'UPDATE requests SET status = ? WHERE id = ?',
    ['Есть отклик', id],
    function (err) {
      if (err) {
        console.error('Ошибка обновления:', err.message);
        return res.status(500).send('Ошибка отклика');
      }

      res.send('Продавец откликнулся');
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});