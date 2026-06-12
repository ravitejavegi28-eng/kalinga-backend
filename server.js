const express = require('express');
const cors = require('cors');
const path = require('path');
const { createBooking, deleteBooking, hasSupabaseConfig, listBookings, updateBookingStatus } = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;
const BOOKING_STATUSES = new Set(['pending', 'confirmed', 'cancelled']);
const BUSINESS_TIME_ZONE = process.env.BOOKING_TIME_ZONE || 'Asia/Kolkata';

app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Admin-Password']
}));
app.options('*', cors());
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function cleanString(value) {
    return String(value || '').trim();
}

function getTodayDateString() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: BUSINESS_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

    return `${values.year}-${values.month}-${values.day}`;
}

function isValidDateString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getAdminPassword() {
    if (process.env.ADMIN_PASSWORD) {
        return process.env.ADMIN_PASSWORD;
    }

    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        return null;
    }

    return 'admin123';
}

function requireAdmin(req, res, next) {
    const expectedPassword = getAdminPassword();

    if (!expectedPassword) {
        return res.status(500).json({
            error: 'Admin password is not configured. Add ADMIN_PASSWORD in Vercel environment variables.'
        });
    }

    if (req.get('X-Admin-Password') !== expectedPassword) {
        return res.status(401).json({ error: 'Invalid admin password' });
    }

    next();
}

function sendApiError(res, error) {
    const statusCode = error.statusCode || error.status || 500;
    console.error(error);
    res.status(statusCode).json({
        error: error.message || 'Something went wrong'
    });
}

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        storage: hasSupabaseConfig() ? 'supabase' : 'local-json'
    });
});

app.post('/api/bookings', async (req, res) => {
    try {
        const bookingInput = {
            name: cleanString(req.body.name),
            phone: cleanString(req.body.phone),
            date: cleanString(req.body.date),
            time: cleanString(req.body.time),
            guests: cleanString(req.body.guests),
            message: cleanString(req.body.message)
        };

        if (!bookingInput.name || !bookingInput.phone || !bookingInput.date || !bookingInput.time || !bookingInput.guests) {
            return res.status(400).json({ error: 'Please fill all required fields.' });
        }

        if (!isValidDateString(bookingInput.date)) {
            return res.status(400).json({ error: 'Please choose a valid booking date.' });
        }

        if (bookingInput.date < getTodayDateString()) {
            return res.status(400).json({ error: 'Please choose today or a future date for your reservation.' });
        }

        const booking = await createBooking(bookingInput);

        res.status(201).json({
            success: true,
            message: 'Booking received. We will confirm soon.',
            bookingId: booking.id
        });
    } catch (error) {
        sendApiError(res, error);
    }
});

app.get('/api/bookings', requireAdmin, async (req, res) => {
    try {
        const bookings = await listBookings();
        res.json(bookings);
    } catch (error) {
        sendApiError(res, error);
    }
});

app.delete('/api/bookings/:id', requireAdmin, async (req, res) => {
    try {
        await deleteBooking(req.params.id);
        res.json({ success: true, message: 'Booking deleted' });
    } catch (error) {
        sendApiError(res, error);
    }
});

app.patch('/api/bookings/:id/status', requireAdmin, async (req, res) => {
    try {
        const status = cleanString(req.body.status).toLowerCase();

        if (!BOOKING_STATUSES.has(status)) {
            return res.status(400).json({
                error: 'Status must be pending, confirmed, or cancelled.'
            });
        }

        const booking = await updateBookingStatus(req.params.id, status);
        res.json({
            success: true,
            message: 'Booking status updated',
            booking
        });
    } catch (error) {
        sendApiError(res, error);
    }
});

app.get(['/', '/admin'], (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Kalinga backend running at http://localhost:${PORT}`);
        console.log(`Admin dashboard: http://localhost:${PORT}/admin`);
        console.log(`Local admin password: ${getAdminPassword() || 'set ADMIN_PASSWORD first'}`);
    });
}

module.exports = app;
