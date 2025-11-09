# ArcPay - AI-Powered USDC Payment System

An intelligent USDC payment application for Arc Testnet with AI-powered transaction processing, automatic payment scheduling, and intelligent risk assessment.

## 🚀 Features

### Core Features
- **User Authentication** - Secure login/signup with email verification
- **Wallet Management** - Automatic wallet creation for each user (one wallet per user)
- **USDC Transfers** - Send and receive USDC on Arc Testnet
- **Payment History** - Track all inbound and outbound transactions
- **Contact Management** - Add and manage contacts with custom names
- **Real-time Balance** - Live wallet balance updates

### AI-Powered Features
- **AI Assistant** - Natural language interface for payments and queries
- **Intent Agent** - Understands user payment requests
- **Risk Management** - Guardriel Agent assesses payment risks
- **Schedule Agent** - Handles recurring and conditional payments
- **Report Analysis** - AI-generated payment insights and charts
- **Automatic Payments** - Execute scheduled payments automatically

### Advanced Features
- **Recurring Payments** - Schedule payments (daily, weekly, monthly, etc.)
- **Conditional Payments** - Execute payments based on conditions (e.g., "if balance >= 10 USDC")
- **Payment Notifications** - Email notifications for all transactions
- **Notification System** - In-app notifications for transactions and alerts
- **Payment Analysis** - Charts and insights into spending patterns

## 📋 Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Arc Testnet account (for testing)
- Email account (Gmail recommended for email verification)

## 🛠️ Installation

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd hello-arc
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
SESSION_SECRET=your-secret-key-change-in-production

# Arc Testnet RPC URL
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network

# Email Configuration (for email verification and notifications)
# For Gmail, use an App Password (not your regular password)
# See Email Setup section below for detailed instructions
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false

# AI Service Configuration
OPENAI_API_KEY=your-openai-api-key
AI_MODEL=gpt-4o-mini
USE_OPENAI=true

# Encryption Key (for automatic payment private key encryption)
# Generate a strong random key for production (e.g., use: openssl rand -hex 32)
ENCRYPTION_KEY=your-encryption-key-change-in-production
```

**⚠️ Important:** Never commit your `.env` file to version control. It contains sensitive information. The `.env.example` file is provided as a template.

### 4. Email Setup (Gmail)

1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account → Security → 2-Step Verification → App passwords
   - Select "Mail" and "Other (Custom name)"
   - Enter "Arc Payment System" as the name
   - Copy the generated 16-character password
3. Use this App Password in your `.env` file as `EMAIL_PASSWORD`

**Note:** If email is not configured, verification codes will be displayed in the server console for testing.

### 5. Start the Server

```bash
npm start
```

The application will be available at `http://localhost:3000`

## 🎯 Usage

### Test Account

A test account is automatically created:
- **Email:** `test@example.com`
- **Password:** `test123`

**⚠️ Important:** The test user's private key is displayed in the server console on first run. Save it securely if you want to use this account.

### Creating an Account

1. Go to the signup page
2. Fill in your details:
   - Email (required, must be unique)
   - Username (required, must be unique, case-insensitive)
   - Password (required, minimum 6 characters)
   - First Name, Last Name (required)
   - Additional fields (optional)
3. Verify your email with the code sent to your inbox
4. A wallet will be automatically created after verification
5. **Save your private key** - it's shown in the server console and sent to your email

### Sending Payments

#### Manual Payment (Transfer Page)
1. Go to "Send Payment" page
2. Select a contact or enter a wallet address
3. Enter the amount
4. Enter your private key
5. Click "Send Payment"

#### AI-Powered Payment
1. Go to "AI Assistant" page
2. Say: "Send 1 USDC to [recipient name]"
3. AI will validate and assess risk
4. Enter your private key when prompted
5. Payment will be executed automatically

### AI Assistant Commands

- **Check Balance:** "What's my balance?"
- **Payment History:** "Show my payment history"
- **Send Payment:** "Send 1 USDC to kani"
- **Recurring Payment:** "Send 1 USDC to kani every Thursday"
- **Conditional Payment:** "Send 1 USDC to kani if I have at least 10 USDC"
- **Cancel Payment:** "Cancel payment #1"
- **Analysis:** "Show me my spending analysis"

### Managing Contacts

1. Go to "Contacts" page
2. Search for users by username
3. Add contacts with custom names
4. Custom names must be unique (no conflicts with usernames or other custom names)

### Automatic Payments

1. Enable automatic payments in your profile (requires private key encryption)
2. Schedule recurring or conditional payments via AI Assistant
3. Payments will execute automatically when conditions are met
4. You can disable automatic payments anytime

## 📁 Project Structure

```
.
├── agents/                    # AI Agents
│   ├── ai-orchestrator.js    # Main orchestrator coordinating all agents
│   ├── intent-agent.js       # Analyzes user intent
│   ├── risk-agent.js         # Risk assessment (Guardriel & Query agents)
│   ├── schedule-agent.js     # Payment scheduling
│   └── report-agent.js       # Payment analysis and reporting
├── server.js                 # Express server
├── database.js               # SQLite database setup and helpers
├── email-service.js          # Email sending service
├── ai-service.js             # AI API wrapper (OpenAI/AIML)
├── scheduler.js              # Payment scheduler (cron jobs)
├── execution-engine.js       # Automatic payment execution
├── crypto-utils.js           # Private key encryption utilities
├── notifications.js          # Frontend notification handling
├── index.html                # Dashboard
├── login.html                # Login page
├── signup.html               # Signup page
├── verify-email.html         # Email verification page
├── forgot-password.html      # Password reset request
├── reset-password.html       # Password reset
├── transfer.html             # Send payment page
├── payment-history.html      # Payment history page
├── contacts.html             # Contacts management
├── profile.html              # User profile
├── ai-chat.html              # AI Assistant interface
├── analysis.html             # Payment analysis page
├── frontend.js               # Dashboard frontend logic
├── frontend-transfer.js      # Transfer page logic
└── package.json              # Dependencies
```

## 🗄️ Database Schema

### Users Table
- User authentication and profile data
- Wallet address (one per user)
- Email verification status
- Automatic payment settings

### Payment History Table
- All transactions (inbound and outbound)
- Transaction type, amount, timestamp
- Transaction hash

### Contacts Table
- User contacts with custom names
- Wallet addresses
- Contact metadata

### Scheduled Payments Table
- Recurring and conditional payments
- Execution schedules
- Payment conditions

### Notifications Table
- User notifications
- Read/unread status
- Notification types

## 🔒 Security Features

- **Password Hashing** - bcrypt for secure password storage
- **Session Management** - Express sessions with secure cookies
- **Private Key Security** - Private keys never stored (except encrypted for automatic payments)
- **Email Verification** - Required for account activation
- **Risk Assessment** - AI-powered payment risk evaluation
- **Input Validation** - Comprehensive validation on all inputs

## 📡 API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `POST /api/auth/verify-email` - Verify email
- `POST /api/auth/resend-verification` - Resend verification code
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `GET /api/auth/check` - Check authentication status

### Wallet & Payments
- `GET /api/balance` - Get wallet balance
- `POST /api/transfer` - Send payment
- `GET /api/payment-history` - Get payment history
- `GET /api/scheduled-payments` - Get scheduled payments
- `DELETE /api/scheduled-payments/:id` - Cancel scheduled payment

### Contacts
- `GET /api/contacts` - Get contacts
- `POST /api/contacts` - Add contact
- `PUT /api/contacts/:id` - Update contact
- `DELETE /api/contacts/:id` - Delete contact
- `GET /api/users/search` - Search users

### AI & Analysis
- `POST /api/ai/chat` - AI Assistant chat
- `GET /api/ai/report` - Get payment analysis report

### Notifications
- `GET /api/notifications` - Get notifications
- `POST /api/notifications/:id/read` - Mark as read
- `POST /api/notifications/read-all` - Mark all as read
- `DELETE /api/notifications/:id` - Delete notification

### Automatic Payments
- `POST /api/auto-pay/enable` - Enable automatic payments
- `POST /api/auto-pay/disable` - Disable automatic payments
- `GET /api/auto-pay/status` - Get automatic payment status

## 🤖 AI Agents Architecture

### Intent Agent
Analyzes user prompts and determines intent (payment, query, etc.)

### Risk Management Agent
- **Guardriel Agent** - Assesses payment risks
- **Query Agent** - Handles non-payment queries

### Schedule Agent
Manages recurring and conditional payments
- Recurring: Daily, weekly, monthly, etc.
- Conditional: Based on balance, date, etc.
- Single: One-time scheduled payments

### Report Analysis Agent
Analyzes payment history and generates insights
- Spending patterns
- Top recipients
- Monthly trends
- Recommendations

## 🔧 Configuration

### Environment Variables

See the `.env` file setup section above for all available configuration options.

### Database

The application uses SQLite for data storage. Database files are created automatically:
- `users.db` - Main database
- `scheduled_payments.db` - Scheduled payments database

## 🐛 Troubleshooting

### Email Not Sending
- Check your email configuration in `.env`
- For Gmail, ensure you're using an App Password (not your regular password)
- Check server logs for email errors

### Payment Fails
- Verify you have sufficient balance (including gas fees)
- Check that the recipient address is valid
- Ensure your private key is correct
- Check server logs for detailed error messages

### AI Assistant Not Working
- Verify your OpenAI API key is set in `.env`
- Check server logs for AI service errors
- Ensure internet connection is stable

### Database Errors
- Delete `users.db` and `scheduled_payments.db` to reset (⚠️ This will delete all data)
- Check file permissions
- Ensure SQLite is installed

## 📝 Development

### Running in Development Mode

```bash
npm start
```

### Adding New Features

1. Backend: Add routes in `server.js`
2. Frontend: Create HTML pages and JavaScript files
3. Database: Add tables/helpers in `database.js`
4. AI Agents: Add new agents in `agents/` directory

## 📄 License

MIT License

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📧 Support

For issues and questions, please open an issue on GitHub.

## 🔮 Future Enhancements

- Multi-chain support
- Advanced analytics
- Mobile app
- Browser extension
- Web3 wallet integration
- More payment scheduling options

---

**⚠️ Important Security Notes:**

- Never commit your `.env` file to version control
- Keep your private keys secure
- Use strong passwords
- Enable 2FA on your email account
- Regularly update dependencies
- Use HTTPS in production

---

## 🔑 API Keys Required

- **OpenAI API Key**: Required for AI features. Get one from [OpenAI Platform](https://platform.openai.com/api-keys)
- **Email Credentials**: Required for email verification. Use Gmail App Password for Gmail accounts.

## 📦 Repository Information

**Suggested Repository Name:** `arcpay`

**Repository Description:** AI-powered USDC payment system for Arc Testnet with automatic scheduling, risk assessment, and intelligent transaction processing.

**Alternative Names:**
- `arc-payment-system`
- `arcpay-ai`
- `arc-usdc-ai`

---

Made with ❤️ for the Arc ecosystem
