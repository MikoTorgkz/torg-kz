const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

// Главная страница
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// ТЕСТ (самое важное)
app.get("/test", (req, res) => {
  res.send("СЕРВЕР ЖИВОЙ 🚀");
});

// Запуск сервера
app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});