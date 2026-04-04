const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT;

const USERS_FILE = path.join(__dirname, "users.json");

function readUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    return [];
  }

  try {
    const data = fs.readFileSync(USERS_FILE, "utf8");
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Ошибка чтения users.json:", error);
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf8");
}

app.use(express.json());
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/test", (req, res) => {
  res.send("TEST OK");
});

app.post("/register", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send("Введите логин и пароль");
  }

  const users = readUsers();

  const exists = users.find((user) => user.username === username);
  if (exists) {
    return res.status(400).send("Такой логин уже существует");
  }

  users.push({
    id: Date.now(),
    username,
    password
  });

  writeUsers(users);

  console.log("Новая регистрация:", username);
  res.send("OK");
});

app.get("/users", (req, res) => {
  const users = readUsers();
  res.json(users);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER WORKING");
});