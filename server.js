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
  pumpState: { type: Boolean, default: false }, 
  isRaining: { type: Boolean, default: false }, 
  manualOverride: { type: Boolean, default: false } 
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
  action: String, 
  timestamp: { type: Date, default: Date.now }
});
const History = mongoose.model('History', HistorySchema);

// 3. Tự động kiểm tra thời tiết tại Quảng Phú, Cư M'gar (Mỗi 1 giờ)
cron.schedule('0 * * * *', async () => {
    try {
        const apiKey = process.env.WEATHER_API_KEY;
        if(!apiKey) {
            console.log("Thiếu WEATHER_API_KEY, bỏ qua check thời tiết.");
            return;
        }
        
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
            await History.create({ action: raining ? 'Cảnh báo: Trời bắt đầu mưa (Hệ thống ngắt tự động)' : 'Thời tiết tạnh ráo (Cho phép bơm)' });
        }
    } catch (error) {
        console.error("Lỗi lấy dữ liệu thời tiết:", error.message);
    }
});

// 4. API Endpoints (Dành cho giao diện Web/App)

app.get('/api/status', async (req, res) => {
    let state = await State.findOne();
    if (!state) state = await State.create({});
    res.json(state);
});

app.post('/api/pump', async (req, res) => {
    const { pumpState } = req.body;
    let state = await State.findOne();
    if (!state) state = await State.create({});
    
    state.pumpState = pumpState;
    await state.save();
    
    await History.create({ action: pumpState ? 'Người dùng BẬT bơm trên App' : 'Người dùng TẮT bơm trên App' });
    res.json({ success: true, state });
});

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

app.get('/api/history', async (req, res) => {
    const history = await History.find().sort({ timestamp: -1 }).limit(50); // Tăng lên 50 dòng để dễ nhìn
    res.json(history);
});

app.delete('/api/history', async (req, res) => {
    await History.deleteMany({});
    res.json({ success: true, message: 'Đã xóa toàn bộ lịch sử' });
});

// ==============================================================
// 5. API Endpoints ĐẶC BIỆT DÀNH CHO ESP32 ĐỒNG BỘ DỮ LIỆU
// ==============================================================

// ESP32 gọi API này mỗi 15 giây để lấy cục bộ Trạng thái Bơm + Thời tiết + Lịch tưới
app.get('/api/esp/sync', async (req, res) => {
    let state = await State.findOne();
    if (!state) state = await State.create({});
    const schedules = await Schedule.find();
    
    res.json({
        pumpState: state.pumpState,
        isRaining: state.isRaining,
        schedules: schedules
    });
});

// ESP32 gọi API này mỗi ngày lúc 02:00 sáng để báo cáo lỗi hoặc báo cáo Reset thành công
app.post('/api/esp/log', async (req, res) => {
    const { date, errors } = req.body;
    
    if (errors && errors.trim() !== "") {
        await History.create({ action: `[BÁO CÁO LỖI THIẾT BỊ] Ngày ${date}: ${errors}` });
    } else {
        await History.create({ action: `[HỆ THỐNG] Đã tự động Reset định kỳ lúc 02:00 sáng để dọn dẹp bộ nhớ (Không có lỗi).` });
    }
    
    res.json({ success: true });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));