// ============================================
// SHOPIFY -> TELEGRAM BOT
// Có chống trùng order
// ============================================

var TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
var CHAT_ID = process.env.CHAT_ID;
var SHOPIFY_SECRET = process.env.SHOPIFY_SECRET;

if (!TELEGRAM_TOKEN || !CHAT_ID || !SHOPIFY_SECRET) {
  console.log("❌ Thiếu biến môi trường.");
  process.exit(1);
}

var http = require("http");
var crypto = require("crypto");
var https = require("https");

var PORT = process.env.PORT || 3000;

// Lưu ID order đã xử lý + webhook ID để tránh trùng
var processedWebhooks = new Set();

function sendTelegram(text) {
  var data = JSON.stringify({ chat_id: CHAT_ID, text: text });
  var req = https.request({
    hostname: "api.telegram.org",
    path: "/bot" + TELEGRAM_TOKEN + "/sendMessage",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
  }, function(res) {
    var body = "";
    res.on("data", function(c) { body += c; });
    res.on("end", function() {
      if (res.statusCode === 200) console.log("✅ Đã gửi Telegram!");
      else console.log("❌ Telegram lỗi:", res.statusCode, body);
    });
  });
  req.on("error", function(e) { console.log("❌ Lỗi:", e.message); });
  req.write(data);
  req.end();
}

function formatOrder(order) {
  var items = (order.line_items || []).map(function(i) {
    return "- " + i.title + " x" + i.quantity;
  }).join("\n");

  var customer = "Khách vãng lai";
  if (order.customer) {
    var fn = order.customer.first_name || "";
    var ln = order.customer.last_name || "";
    customer = (fn + " " + ln).trim() || "Khách vãng lai";
  }

  var addr = order.shipping_address;
  var address = "Không có";
  var phone = order.phone || "N/A";
  if (addr) {
    address = (addr.address1 || "") + ", " + (addr.city || "") + ", " + (addr.country || "");
    if (!order.phone && addr.phone) phone = addr.phone;
  }

  var msg = "🛒 ĐƠN HÀNG MỚI " + order.name + "\n\n";
  msg += "👤 Khách: " + customer + "\n";
  msg += "📱 SĐT: " + phone + "\n";
  msg += "📧 Email: " + (order.email || "N/A") + "\n\n";
  msg += "🛍 Sản phẩm:\n" + items + "\n\n";
  msg += "💵 Tổng: " + order.total_price + " " + order.currency + "\n";
  msg += "📍 Giao tới: " + address;
  return msg;
}

http.createServer(function(req, res) {
  if (req.url === "/test") {
    sendTelegram("✅ Bot hoạt động trên Render!");
    res.end("Đã gửi test");
    return;
  }

  if (req.url === "/webhook" && req.method === "POST") {
    var body = "";
    req.on("data", function(c) { body += c; });
    req.on("end", function() {
      var hmac = req.headers["x-shopify-hmac-sha256"];
      var hash = crypto.createHmac("sha256", SHOPIFY_SECRET).update(body, "utf8").digest("base64");
      if (hash !== hmac) {
        console.log("⚠️ HMAC sai");
        res.writeHead(401);
        res.end();
        return;
      }

      // Phản hồi OK ngay lập tức để Shopify không retry
      res.writeHead(200);
      res.end("OK");

      try {
        // Dùng webhook ID (unique cho mỗi lần Shopify gửi) để chống trùng
        var webhookId = req.headers["x-shopify-webhook-id"];
        var orderId = JSON.parse(body).id;
        var uniqueKey = webhookId || orderId;

        if (processedWebhooks.has(uniqueKey)) {
          console.log("⏭️ Bỏ qua webhook trùng: " + uniqueKey);
          return;
        }
        processedWebhooks.add(uniqueKey);

        // Giới hạn Set không quá 1000 mục để không tốn RAM
        if (processedWebhooks.size > 1000) {
          var firstKey = processedWebhooks.values().next().value;
          processedWebhooks.delete(firstKey);
        }

        var order = JSON.parse(body);
        console.log("📥 Order: " + order.name + " (webhook " + uniqueKey + ")");
        sendTelegram(formatOrder(order));
      } catch (e) {
        console.log("❌", e.message);
      }
    });
    return;
  }

  res.end("Bot đang chạy");
}).listen(PORT, "0.0.0.0", function() {
  console.log("🚀 Bot chạy tại port " + PORT);
});
