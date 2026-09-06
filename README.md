# UGcrash (BlastBet) - Real-Time Crash Game Platform

A server-authoritative crash gambling platform built with Node.js. Features a custom WebSocket engine, real-time betting, secure Paystack (M-Pesa/Airtel) integration, an admin dashboard, and a mobile-ready prediction app.

> **⚠️ 18+ ONLY:** This software is for demonstration purposes. It involves real-money wagering. You are responsible for ensuring compliance with the gambling laws in your jurisdiction (Kenya/Uganda).

## ✨ Features

- **Server-Authoritative Engine:** Crash points are generated on the server, ensuring clients cannot manipulate outcomes.
- **Real-Time WebSocket Betting:** Place bets and cash out instantly with sub-100ms latency.
- **Persistent History:** All crash points are saved to a JSON file (`history.json`) and persist even after server restarts.
- **Paystack STK Push:** Native integration for Kenyan M-Pesa and Airtel Money deposits (with automatic wallet crediting via webhooks).
- **Predictor Module:** A secure, token-based WebSocket endpoint (`/predictor`) that shows the crash point to authorized users.
- **Admin Dashboard:** Protected (`admin.html`) by an environment variable password.
- **Mobile-First Design:** Optimized UI for mobile devices and ready to be wrapped using Capacitor for native Android/iOS apps.

## 🛠️ Tech Stack

- **Backend:** Node.js, Express.js
- **Real-Time:** `ws` (WebSocket)
- **Payments:** Paystack API (STK Push & Card)
- **Storage:** JSON File System (or MongoDB via `userStore.js`)
- **Frontend:** HTML5, CSS3, Vanilla JavaScript

## 🚀 Getting Started (Local Development)

### Prerequisites
- Node.js (v16 or higher)
- npm
- A Paystack account (Live or Test keys)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/nocturn-hq/UGcrash.git
   cd UGcrash
