const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BOOKINGS_FILE = process.env.BOOKINGS_FILE || path.join(__dirname, 'bookings.json');
const TABLE_NAME = process.env.SUPABASE_BOOKINGS_TABLE || 'bookings';
const STATUS_MARKER_PATTERN = /^\[booking-status:(pending|confirmed|cancelled)\]\s*/i;
const BUSINESS_TIME_ZONE = process.env.BOOKING_TIME_ZONE || 'Asia/Kolkata';

let supabaseClient;

function hasSupabaseConfig() {
    return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getSupabase() {
    if (!hasSupabaseConfig()) {
        return null;
    }

    if (!supabaseClient) {
        supabaseClient = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            {
                auth: {
                    persistSession: false
                }
            }
        );
    }

    return supabaseClient;
}

function requireProductionStorage() {
    if (process.env.VERCEL && !hasSupabaseConfig()) {
        const error = new Error('Database is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables.');
        error.statusCode = 500;
        throw error;
    }
}

function ensureLocalFile() {
    if (!fs.existsSync(BOOKINGS_FILE)) {
        fs.writeFileSync(BOOKINGS_FILE, JSON.stringify({ bookings: [] }, null, 2));
    }
}

function readLocalBookings() {
    ensureLocalFile();
    const data = JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
    return Array.isArray(data.bookings) ? data.bookings : [];
}

function writeLocalBookings(bookings) {
    fs.writeFileSync(BOOKINGS_FILE, JSON.stringify({ bookings }, null, 2));
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

function hasPastBookingDate(value, today = getTodayDateString()) {
    const date = String(value || '').slice(0, 10);

    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today;
}

function normalizeStatus(value) {
    const status = String(value || 'pending').toLowerCase();
    return ['pending', 'confirmed', 'cancelled'].includes(status) ? status : 'pending';
}

function parseStoredMessage(value) {
    const rawMessage = String(value || '');
    const match = rawMessage.match(STATUS_MARKER_PATTERN);

    return {
        message: rawMessage.replace(STATUS_MARKER_PATTERN, ''),
        status: normalizeStatus(match ? match[1] : 'pending')
    };
}

function messageWithStatus(value, status) {
    const cleanMessage = parseStoredMessage(value).message.trim();
    const cleanStatus = normalizeStatus(status);

    if (cleanStatus === 'pending') {
        return cleanMessage;
    }

    return `[booking-status:${cleanStatus}] ${cleanMessage}`.trim();
}

function isMissingStatusColumn(error) {
    const message = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
    return /status/i.test(message) && /column|schema cache|PGRST204/i.test(message);
}

function normalizeBooking(row) {
    const parsedMessage = parseStoredMessage(row.message);

    return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        date: row.booking_date || row.date,
        time: row.booking_time || row.time,
        guests: row.guests,
        message: parsedMessage.message,
        status: normalizeStatus(row.status || parsedMessage.status),
        submittedAt: row.submitted_at || row.submittedAt
    };
}

async function createBooking(input) {
    requireProductionStorage();

    const submittedAt = new Date().toISOString();
    const booking = {
        id: Date.now(),
        name: input.name,
        phone: input.phone,
        date: input.date,
        time: input.time,
        guests: input.guests,
        message: input.message || '',
        status: 'pending',
        submittedAt
    };

    const supabase = getSupabase();
    if (supabase) {
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .insert({
                id: booking.id,
                name: booking.name,
                phone: booking.phone,
                booking_date: booking.date,
                booking_time: booking.time,
                guests: booking.guests,
                message: booking.message,
                submitted_at: booking.submittedAt
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        return normalizeBooking(data);
    }

    const bookings = readLocalBookings();
    bookings.push(booking);
    writeLocalBookings(bookings);
    return booking;
}

async function listBookings() {
    requireProductionStorage();
    await deletePastBookings();

    const supabase = getSupabase();
    if (supabase) {
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .select('*')
            .order('submitted_at', { ascending: false });

        if (error) {
            throw error;
        }

        return data.map(normalizeBooking);
    }

    return readLocalBookings().sort((a, b) => {
        return new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime();
    });
}

async function deletePastBookings() {
    const today = getTodayDateString();
    const supabase = getSupabase();

    if (supabase) {
        const { error } = await supabase
            .from(TABLE_NAME)
            .delete()
            .lt('booking_date', today);

        if (error) {
            throw error;
        }

        return;
    }

    const bookings = readLocalBookings();
    const activeBookings = bookings.filter((booking) => !hasPastBookingDate(booking.date, today));

    if (activeBookings.length !== bookings.length) {
        writeLocalBookings(activeBookings);
    }
}

async function deleteBooking(id) {
    requireProductionStorage();

    const supabase = getSupabase();
    if (supabase) {
        const { error } = await supabase
            .from(TABLE_NAME)
            .delete()
            .eq('id', id);

        if (error) {
            throw error;
        }

        return;
    }

    const bookings = readLocalBookings();
    writeLocalBookings(bookings.filter((booking) => Number(booking.id) !== Number(id)));
}

async function updateBookingStatus(id, status) {
    requireProductionStorage();
    const cleanStatus = normalizeStatus(status);

    const supabase = getSupabase();
    if (supabase) {
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .update({ status: cleanStatus })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            if (!isMissingStatusColumn(error)) {
                throw error;
            }

            return updateBookingStatusInMessage(supabase, id, cleanStatus);
        }

        return normalizeBooking(data);
    }

    const bookings = readLocalBookings();
    const booking = bookings.find((item) => Number(item.id) === Number(id));

    if (!booking) {
        const error = new Error('Booking not found');
        error.statusCode = 404;
        throw error;
    }

    booking.status = cleanStatus;
    writeLocalBookings(bookings);
    return normalizeBooking(booking);
}

async function updateBookingStatusInMessage(supabase, id, status) {
    const { data: existingBooking, error: fetchError } = await supabase
        .from(TABLE_NAME)
        .select('id, name, phone, booking_date, booking_time, guests, message, submitted_at')
        .eq('id', id)
        .single();

    if (fetchError) {
        throw fetchError;
    }

    const { data, error } = await supabase
        .from(TABLE_NAME)
        .update({
            message: messageWithStatus(existingBooking.message, status)
        })
        .eq('id', id)
        .select('id, name, phone, booking_date, booking_time, guests, message, submitted_at')
        .single();

    if (error) {
        throw error;
    }

    return normalizeBooking(data);
}

module.exports = {
    createBooking,
    deleteBooking,
    hasSupabaseConfig,
    listBookings,
    updateBookingStatus
};
