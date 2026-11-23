#!/usr/bin/env node
/**
 * Fleet socket test tool — run from the Delivery-PWA repo root.
 *
 * MONITOR mode (admin login): attaches a viewer socket to a channel and
 * prints every driver-update / driver-live push with timestamps.
 *
 *   node scripts/test-fleet-socket.js monitor \
 *     --user superadmin@email --pass secret --channel ind-madurai
 *
 * DRIVE mode (DELIVERY-PERSON login): connects a driver socket and streams
 * fake moving ride-fixes every 2.5 s — the fleet page's marker for that
 * driver should glide live WITHOUT any phone involved. (Must be run with a
 * delivery person's credentials — a superadmin is never listed on the fleet
 * page, so their fixes patch no row.)
 *
 *   node scripts/test-fleet-socket.js drive \
 *     --user vinoth@email --pass secret --channel ind-madurai --order 123
 *
 * Default API is http://localhost:3001/admin-api — override with
 * --api https://your-tunnel.trycloudflare.com/admin-api
 */
const { io } = require('socket.io-client');

const args = process.argv.slice(2);
const mode = args[0];
const opt = name => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
};
const API = opt('api') ?? 'http://localhost:3001/admin-api';
const USER = opt('user');
const PASS = opt('pass');
const CHANNEL = opt('channel');
const ORDER = opt('order') ?? '0';

if (!['monitor', 'drive'].includes(mode) || !USER || !PASS || !CHANNEL) {
    console.log('usage: node scripts/test-fleet-socket.js <monitor|drive> --user U --pass P --channel TOKEN [--order ID] [--api URL]');
    process.exit(1);
}

const ORIGIN = new URL(API).origin;
const ts = () => new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });

async function gql(query, cookie) {
    const res = await fetch(API, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(cookie ? { Cookie: cookie } : {}),
            'vendure-token': CHANNEL,
        },
        body: JSON.stringify({ query }),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 250));
    return { data: json.data, cookie: setCookie.map(c => c.split(';')[0]).join('; ') };
}

(async () => {
    const login = await gql(
        `mutation { login(username: "${USER}", password: "${PASS}") { ... on CurrentUser { id } ... on ErrorResult { errorCode message } } }`,
    );
    if (!login.data.login.id) throw new Error('login failed: ' + JSON.stringify(login.data.login));
    console.log(`[${ts()}] logged in as ${USER} (channel ${CHANNEL}, api ${ORIGIN})`);

    if (mode === 'monitor') {
        const connect = async () => {
            const ticket = (await gql(`{ fleetSocketTicket }`, login.cookie)).data.fleetSocketTicket;
            const s = io(ORIGIN, { path: '/fleet-io', transports: ['websocket'], reconnection: false, auth: { ticket } });
            s.on('connect', () => console.log(`[${ts()}] viewer connected — waiting for pushes (Ctrl+C to stop)`));
            s.on('driver-update', u =>
                console.log(`[${ts()}] driver-update  ${u.name} state=${u.state} pos=${u.lat},${u.lng} mToday=${u.metersToday} order=${u.activeOrderCode ?? '-'}`));
            s.on('driver-live', u =>
                console.log(`[${ts()}] driver-live    admin=${u.administratorId} pos=${u.lat},${u.lng} rideM=${u.rideDistanceMeters}`));
            s.on('disconnect', r => { console.log(`[${ts()}] disconnected (${r}) — redialing`); setTimeout(connect, 3000); });
            s.on('connect_error', e => { console.log(`[${ts()}] connect_error ${e.message} — retry`); setTimeout(connect, 3000); });
        };
        await connect();
    } else {
        const ticket = (await gql(`{ driverSocketTicket }`, login.cookie)).data.driverSocketTicket;
        const s = io(ORIGIN, { path: '/fleet-io', transports: ['websocket'], reconnection: false, auth: { ticket } });
        // Fake ride: starts near Madurai, drifts north-east ~11 m per tick
        let lat = 9.9359, lng = 78.1018, meters = 0;
        s.on('connect', () => {
            console.log(`[${ts()}] driver socket connected — streaming a fake ride (Ctrl+C to stop)`);
            setInterval(() => {
                lat += 0.0001; lng += 0.00005; meters += 12;
                s.emit('ride-fix', { orderId: ORDER, lat, lng, heading: 30, rideDistanceMeters: meters });
                console.log(`[${ts()}] sent ride-fix pos=${lat.toFixed(5)},${lng.toFixed(5)} m=${meters}`);
            }, 2500);
        });
        s.on('connect_error', e => { console.log(`connect_error: ${e.message}`); process.exit(1); });
        s.on('disconnect', r => { console.log(`disconnected: ${r}`); process.exit(1); });
    }
})().catch(e => { console.log('FATAL:', e.message); process.exit(1); });
