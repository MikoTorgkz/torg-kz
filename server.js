const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.status(200).send("HOME OK");
});

app.get("/test", (req, res) => {
  res.status(200).send("TEST OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER VERSION 2");
  console.log("Server started on port " + PORT);
});