const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Torg KZ работает 🚀");
});

app.get("/test", (req, res) => {
  res.send("OK ✅");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server started on port " + PORT);
});