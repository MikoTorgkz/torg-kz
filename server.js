const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.', { index: false }));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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

app.get('/requests', (req, res) => {
  db.all('SELECT * FROM requests ORDER BY id DESC', [], (err, rows) => {
    if (err) {
      console.error('Ошибка получения данных:', err.message);
      return res.status(500).send('Ошибка получения данных');
    }

    res.json(rows);
  });
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});