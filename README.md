# MedBot - AI-Powered Medical Assistant

MedBot is an intelligent medical assistant web application that provides instant medical guidance and personalized health consultations through an advanced AI-powered chatbot.

## 🔍 Features

- **AI-Powered Symptom Analysis**: Advanced diagnostic assistance using cutting-edge artificial intelligence
- **Personalized Medical Consultations**: Tailored health assessments based on user's medical history and symptoms
- **User Authentication**: Secure login and registration system with password encryption
- **Medical History Tracking**: Keep track of previous consultations and diagnoses
- **Urgent Care Detection**: Automatic detection of potentially critical symptoms with appropriate guidance
- **Responsive Design**: Fully responsive interface that works on all devices

## 🛠️ Technology Stack

### Frontend
- **React**: For building the user interface
- **React Router**: For client-side routing
- **Tailwind CSS**: For styling and responsive design
- **React Icons**: For beautiful, consistent iconography

### Backend
- **FastAPI**: High-performance web framework for building APIs
- **Pydantic**: Data validation and settings management
- **OAuth2**: Authentication with JWT tokens
- **Natural Language Processing**: For advanced symptom analysis and diagnosis generation

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- Python (v3.8 or higher)
- npm or yarn

### Installation

#### Clone the repository
```bash
git clone https://github.com/yourusername/medbot.git
cd medbot
```

#### Frontend Setup
```bash
cd frontend
npm install
npm start
```

#### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

## 📱 Application Structure

### Frontend
- **AuthContext**: Manages user authentication state across the application
- **LandingPage**: Introduction to MedBot with feature highlights
- **RegisterPage**: Multi-step registration form collecting user information
- **LoginPage**: User authentication with email and password
- **ChatPage**: Main interface for interacting with the AI medical assistant

### Backend
- **User Management**: Authentication, registration, and user profile management
- **Chat System**: Processes user symptoms and generates medical guidance
- **Diagnosis Engine**: AI-powered symptom analysis and diagnosis generation
- **Medical History**: Storage and retrieval of past consultations

## 🔒 Security Features

- Password hashing with industry-standard algorithms
- JWT-based authentication
- Input validation and sanitization
- Protected API endpoints requiring authentication

## 🧪 How It Works

1. **User Registration**: Users create an account with personal and medical information
2. **Symptom Collection**: The AI chatbot collects information about symptoms through a conversational interface
3. **Medical History**: Relevant medical history is collected and incorporated into the analysis
4. **Diagnosis Generation**: AI processes the symptoms and medical history to provide potential diagnoses
5. **Critical Assessment**: System automatically flags potentially urgent conditions
6. **Recommendations**: Tailored recommendations based on the diagnosis
7. **History Storage**: Consultations are saved for future reference

## 📖 API Endpoints

- **POST /register**: Create a new user account
- **POST /login**: Authenticate a user and receive access token
- **POST /chat**: Process chat messages and get AI responses
- **GET /chat_history/{user_id}**: Retrieve a user's chat history
- **POST /save_chat_history**: Save a chat session to history
- **GET /view_summary/{user_id}/{summary_id}**: View a specific consultation summary

## 📋 Future Enhancements

- Integration with wearable health devices
- Medication reminders and tracking
- Appointment scheduling with healthcare providers
- Symptom trend analysis over time
- Multi-language support

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## ⚠️ Disclaimer

MedBot is designed to provide general health information and is not intended to replace professional medical advice, diagnosis, or treatment. Always consult with a qualified healthcare provider for medical concerns. 