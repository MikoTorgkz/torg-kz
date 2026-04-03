const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Главная страница
app.get("/", (req, res) => {
  res.send("Torg KZ работает 🚀");
});

// Тест
app.get("/test", (req, res) => {
  res.send("OK ✅");
});

// Запуск сервера
app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});