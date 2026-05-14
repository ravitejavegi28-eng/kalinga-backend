const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BOOKINGS_FILE = process.env.BOOKINGS_FILE || path.join(__dirname, 'bookings.json');
const TABLE_NAME = process.env.SUPABASE_BOOKINGS_TABLE || 'bookings';

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

function normalizeBooking(row) {
    return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        date: row.booking_date || row.date,
        time: row.booking_time || row.time,
        guests: row.guests,
        message: row.message || '',
        status: row.status || 'pending',
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

    const supabase = getSupabase();
    if (supabase) {
        const { data, error } = await supabase
            .from(TABLE_NAME)
            .update({ status })
            .eq('id', id)
            .select()
            .single();

        if (error) {
            throw error;
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

    booking.status = status;
    writeLocalBookings(bookings);
    return normalizeBooking(booking);
}

module.exports = {
    createBooking,
    deleteBooking,
    hasSupabaseConfig,
    listBookings,
    updateBookingStatus
};
