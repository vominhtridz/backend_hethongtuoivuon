// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

// 1. Kết nối MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://trilove156_db_user:HMDozbVmq2EWKQzK@tuoirau.kddcp9n.mongodb.net/?appName=tuoirau');

// 2. Khai báo Schema & Models
const SystemStateSchema = new mongoose.Schema({
  pumpState: { type: Boolean, default: false }, // Lệnh bật từ người dùng hoặc lịch trình
  isRaining: { type: Boolean, default: false }, // Cờ thời tiết
  manualOverride: { type: Boolean, default: false } // Bỏ qua thời tiết nếu người dùng ép bật
});
const State = mongoose.model('State', SystemStateSchema);

const ScheduleSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now },
  time: String, // Định dạng "HH:mm"
  durationMinutes: Number,
  isActive: { type: Boolean, default: true }
});
const Schedule = mongoose.model('Schedule', ScheduleSchema);

const HistorySchema = new mongoose.Schema({
  action: String, // "Bật bơm", "Tắt bơm", "Hệ thống tự ngắt do mưa"
  timestamp: { type: Date, default: Date.now }
});
const History = mongoose.model('History', HistorySchema);

// 3. Tự động kiểm tra thời tiết tại Quảng Phú, Cư M'gar (Mỗi 1 giờ)
// Tọa độ Cư M'gar xấp xỉ: Lat 12.83, Lon 108.06 hoặc dùng tên thành phố
cron.schedule('0 * * * *', async () => {
    try {
        const apiKey = process.env.WEATHER_API_KEY;
        const lat = 12.8333; 
        const lon = 108.0667;
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`;
        
        const response = await axios.get(url);
        // Kiểm tra mã thời tiết (Nhóm 2xx, 3xx, 5xx là có mưa)
        const weatherId = response.data.weather[0].id;
        const raining = weatherId < 600; 

        let state = await State.findOne();
        if (!state) state = new State();
        
        if (state.isRaining !== raining) {
            state.isRaining = raining;
            await state.save();
            await History.create({ action: raining ? 'Cảnh báo: Trời bắt đầu mưa' : 'Thời tiết tạnh ráo' });
        }
    } catch (error) {
        console.error("Lỗi lấy dữ liệu thời tiết:", error.message);
    }
});

// 4. API Endpoints

// GET /api/status - Dành cho Frontend
app.get('/api/status', async (req, res) => {
    let state = await State.findOne();
    if (!state) state = await State.create({});
    res.json(state);
});

// POST /api/pump - Điều khiển bơm thủ công
app.post('/api/pump', async (req, res) => {
    const { pumpState } = req.body;
    let state = await State.findOne();
    state.pumpState = pumpState;
    await state.save();
    
    await History.create({ action: pumpState ? 'Người dùng bật bơm thủ công' : 'Người dùng tắt bơm thủ công' });
    res.json({ success: true, state });
});

// GET /api/esp/status - Dành riêng cho ESP32 đọc (Logic quyết định cuối cùng)
app.get('/api/esp/status', async (req, res) => {
    const state = await State.findOne();
    // Bơm chỉ chạy nếu người dùng lệnh bật VÀ không mưa (trừ khi bật chế độ override)
    const shouldRun = state.pumpState && (!state.isRaining || state.manualOverride);
    res.send(shouldRun ? "1" : "0");
});

// CRUD Lịch trình (Schedules)
app.get('/api/schedules', async (req, res) => {
    const schedules = await Schedule.find();
    res.json(schedules);
});

app.post('/api/schedules', async (req, res) => {
    const newSchedule = await Schedule.create(req.body);
    res.json(newSchedule);
});

app.delete('/api/schedules/:id', async (req, res) => {
    await Schedule.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});

// GET /api/history
app.get('/api/history', async (req, res) => {
    const history = await History.find().sort({ timestamp: -1 }).limit(20);
    res.json(history);
});
// THÊM ĐOẠN NÀY VÀO ĐỂ XÓA TOÀN BỘ LỊCH SỬ
app.delete('/api/history', async (req, res) => {
    await History.deleteMany({}); // Xóa sạch dữ liệu trong bảng History
    res.json({ success: true, message: 'Đã xóa toàn bộ lịch sử' });
});
app.listen(5000, () => console.log('Server running on port 5000'));