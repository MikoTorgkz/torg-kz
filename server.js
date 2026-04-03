const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.send("Сервер работает");
});

app.get("/test", (req, res) => {
  res.send("OK 🚀");
});

app.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});