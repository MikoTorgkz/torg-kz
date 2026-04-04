const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT;

// отдаём html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// тест
app.get("/test", (req, res) => {
  res.send("TEST OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER WORKING");
});