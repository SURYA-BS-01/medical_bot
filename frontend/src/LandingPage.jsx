import { useNavigate } from 'react-router-dom';
import { MdMedicalServices, MdOutlineHealthAndSafety, MdOutlineHistory } from 'react-icons/md';

const LandingPage = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-6 py-16">
        <nav className="flex justify-between items-center mb-16">
          <h1 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <MdMedicalServices className="text-blue-500" />
            MedBot
          </h1>
          <div className="flex space-x-4">
            <button
              onClick={() => navigate('/login')}
              className="bg-white hover:bg-gray-100 text-blue-600 px-6 py-2 rounded-lg border border-blue-200 transition-all shadow-sm"
            >
              Login
            </button>
            <button
              onClick={() => navigate('/register')}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-all shadow-sm flex items-center gap-2"
            >
              <span>Sign Up</span>
            </button>
          </div>
        </nav>

        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-5xl font-bold text-gray-800 mb-8">
            Your Personal Medical Assistant
          </h2>
          <p className="text-xl text-gray-600 mb-12">
            Get instant medical guidance and symptom assessment through our advanced AI-powered chatbot
          </p>

          <div className="grid md:grid-cols-3 gap-8 mb-16">
            {features.map((feature, index) => (
              <div key={index} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-blue-500 text-3xl mb-4 flex justify-center">{feature.icon}</div>
                <h3 className="text-xl font-semibold text-gray-800 mb-2">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate('/register')}
            className="bg-blue-600 hover:bg-blue-700 text-white text-lg px-8 py-3 rounded-lg transition-all shadow-sm flex items-center gap-2 mx-auto"
          >
            <MdOutlineHealthAndSafety size={20} />
            <span>Start Your Consultation</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const features = [
  {
    icon: <MdOutlineHealthAndSafety size={32} />,
    title: "24/7 Availability",
    description: "Get medical guidance anytime, anywhere with our always-available chatbot"
  },
  {
    icon: <MdMedicalServices size={32} />,
    title: "AI-Powered Analysis",
    description: "Advanced symptom analysis using cutting-edge artificial intelligence"
  },
  {
    icon: <MdOutlineHistory size={32} />,
    title: "Medical History Tracking",
    description: "Keep track of your medical history and previous consultations"
  }
];

export default LandingPage; 
