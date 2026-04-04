const express = require("express");

const app = express();
const PORT = process.env.PORT;

app.get("/", (req, res) => {
  res.send("HOME OK");
});

app.get("/test", (req, res) => {
  res.send("TEST OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER VERSION 3");
  console.log("Server started on port " + PORT);
});