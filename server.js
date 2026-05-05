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
  manualOverride: { type: Boolean, default: false },
  isScheduleRunning: { type: Boolean, default: false } // THÊM CỜ: Để máy chủ biết lịch có đang chạy không
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

// =========================================================================
// 3. TÁC VỤ NGẦM (CRON JOBS) - ĐÃ ĐƯỢC ÉP CHẠY THEO GIỜ VIỆT NAM
// =========================================================================

// A. Tự động kiểm tra thời tiết tại Quảng Phú, Cư M'gar (Mỗi 1 giờ)
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
}, {
    scheduled: true,
    timezone: "Asia/Ho_Chi_Minh" // Ép múi giờ VN
});

// B. KIỂM TRA LỊCH TRÌNH TƯỚI (MỖI 1 PHÚT)
cron.schedule('* * * * *', async () => {
    try {
        // Lấy giờ phút chuẩn của Việt Nam bất chấp server đặt ở Mỹ hay Singapore
        const vnTimeStr = new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" });
        const vnDate = new Date(vnTimeStr);
        const currentHour = vnDate.getHours();
        const currentMinute = vnDate.getMinutes();
        const currentMinutesTotal = currentHour * 60 + currentMinute;

        const schedules = await Schedule.find();
        let isAnyScheduleRunning = false;

        // Quét tất cả các lịch trong DataBase
        for (let sched of schedules) {
            if (!sched.time) continue;
            const [h, m] = sched.time.split(':').map(Number);
            const startMinutes = h * 60 + m;
            const endMinutes = startMinutes + sched.durationMinutes;

            // Nếu giờ VN hiện tại nằm gọn trong khung giờ cài đặt
            if (currentMinutesTotal >= startMinutes && currentMinutesTotal < endMinutes) {
                isAnyScheduleRunning = true;
                break;
            }
        }

        let state = await State.findOne();
        if (!state) state = await State.create({});

        // NẾU CÓ LỊCH ĐANG CHẠY MÀ TRƯỚC ĐÓ CỜ CHƯA BẬT (Tránh ghi log lặp lại mỗi phút)
        if (isAnyScheduleRunning && !state.isScheduleRunning) {
            state.isScheduleRunning = true;
            await state.save();
            
            if (!state.isRaining) {
                await History.create({ action: `⏰ ĐẾN GIỜ HẸN: Bắt đầu tưới tự động theo lịch (${currentHour}:${currentMinute < 10 ? '0'+currentMinute : currentMinute})` });
            } else {
                await History.create({ action: '⏰ Đến giờ hẹn tưới, NHƯNG BỎ QUA do trời đang mưa!' });
            }
        } 
        // NẾU HẾT LỊCH (HOẶC CHƯA TỚI) MÀ CỜ VẪN ĐANG BẬT -> TẮT CỜ ĐI VÀ GHI LOG
        else if (!isAnyScheduleRunning && state.isScheduleRunning) {
            state.isScheduleRunning = false;
            await state.save();
            await History.create({ action: `⏰ HẾT GIỜ HẸN: Đã tự động tắt bơm (${currentHour}:${currentMinute < 10 ? '0'+currentMinute : currentMinute})` });
        }

    } catch (error) {
        console.error("Lỗi duyệt lịch trình:", error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Ho_Chi_Minh" // Ép múi giờ VN
});


// =========================================================================
// 4. API Endpoints (Dành cho giao diện Web/App)
// =========================================================================

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
    
    await History.create({ action: pumpState ? 'Người dùng BẬT bơm thủ công trên App' : 'Người dùng TẮT bơm thủ công trên App' });
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
    const history = await History.find().sort({ timestamp: -1 }).limit(50); // Lấy 50 dòng mới nhất
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
        await History.create({ action: `[BÁO CÁO LỖI THIẾT BỊ] ESP32 gửi: ${errors}` });
    } else {
        await History.create({ action: `[HỆ THỐNG] Mạch ESP32 đã tự động Reset định kỳ lúc 02:00 sáng để dọn dẹp bộ nhớ an toàn.` });
    }
    
    res.json({ success: true });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));