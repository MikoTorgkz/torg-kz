const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ЛОГ (чтобы видеть запросы)
app.use((req, res, next) => {
  console.log("Request:", req.url);
  next();
});

// статические файлы
app.use(express.static(path.resolve(".")));

// главная страница
app.get("/", (req, res) => {
  res.sendFile(path.resolve("index.html"));
});

// fallback
app.get("*", (req, res) => {
  res.sendFile(path.resolve("index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server started on port " + PORT);
});