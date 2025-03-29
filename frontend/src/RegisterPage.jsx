import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { FiUser, FiLock, FiMail, FiCalendar, FiUserPlus } from 'react-icons/fi';
import { MdMedicalServices, MdOutlineHealthAndSafety, MdOutlineMedication } from 'react-icons/md';
import { BiMaleFemale } from 'react-icons/bi';
import { RiHeartPulseLine } from 'react-icons/ri';
import { GiMedicines } from 'react-icons/gi';
import { useAuth } from './AuthContext';

const RegisterPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    gender: '',
    age: '',
    comorbidities: [],
    medications: [],
    allergies: []
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [tempComorbidity, setTempComorbidity] = useState('');
  const [tempMedication, setTempMedication] = useState('');
  const [tempAllergy, setTempAllergy] = useState('');

  const addComorbidity = () => {
    if (tempComorbidity.trim()) {
      setFormData({
        ...formData,
        comorbidities: [...formData.comorbidities, tempComorbidity.trim()]
      });
      setTempComorbidity('');
    }
  };

  const removeComorbidity = (index) => {
    const newList = [...formData.comorbidities];
    newList.splice(index, 1);
    setFormData({
      ...formData,
      comorbidities: newList
    });
  };

  const addMedication = () => {
    if (tempMedication.trim()) {
      setFormData({
        ...formData,
        medications: [...formData.medications, tempMedication.trim()]
      });
      setTempMedication('');
    }
  };

  const removeMedication = (index) => {
    const newList = [...formData.medications];
    newList.splice(index, 1);
    setFormData({
      ...formData,
      medications: newList
    });
  };

  const addAllergy = () => {
    if (tempAllergy.trim()) {
      setFormData({
        ...formData,
        allergies: [...formData.allergies, tempAllergy.trim()]
      });
      setTempAllergy('');
    }
  };

  const removeAllergy = (index) => {
    const newList = [...formData.allergies];
    newList.splice(index, 1);
    setFormData({
      ...formData,
      allergies: newList
    });
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    
    // For name field, only allow alphabets and spaces
    if (name === 'name') {
      // Replace any non-alphabet and non-space character with empty string
      const sanitizedValue = value.replace(/[^A-Za-z\s]/g, '');
      setFormData({
        ...formData,
        [name]: sanitizedValue
      });
    } else {
      setFormData({
        ...formData,
        [name]: value
      });
    }
    
    // Clear error when user types
    if (errors[name]) {
      setErrors({
        ...errors,
        [name]: ''
      });
    }
  };

  const validateFirstStep = () => {
    const newErrors = {};
    
    // Name validation
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Name must be at least 2 characters';
    } else if (!/^[A-Za-z\s]+$/.test(formData.name)) {
      newErrors.name = 'Name should only contain alphabets and spaces';
    }

    // Email validation
    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Email is invalid';
    }
    
    // Password validation
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    } else if (!/[A-Z]/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one capital letter';
    } else if (!/[0-9]/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one number';
    } else if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]+/.test(formData.password)) {
      newErrors.password = 'Password must contain at least one special character';
    }
    
    // Confirm password validation
    if (!formData.confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateSecondStep = () => {
    const newErrors = {};
    
    // Gender validation
    if (!formData.gender) {
      newErrors.gender = 'Gender is required';
    }
    
    // Age validation
    if (!formData.age) {
      newErrors.age = 'Age is required';
    } else if (isNaN(formData.age) || parseInt(formData.age) <= 0 || parseInt(formData.age) > 120) {
      newErrors.age = 'Please enter a valid age (1-120)';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (currentStep === 1 && validateFirstStep()) {
      setCurrentStep(2);
    } else if (currentStep === 2 && validateSecondStep()) {
      setCurrentStep(3);
    }
  };

  const handleBack = () => {
    setCurrentStep(currentStep - 1);
    // Clear errors when going back
    setErrors({});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('http://localhost:8000/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          password: formData.password,
          gender: formData.gender,
          age: parseInt(formData.age),
          comorbidities: formData.comorbidities,
          medications: formData.medications,
          allergies: formData.allergies
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Registration failed');
      }

      // Use the login function from context instead of directly setting localStorage
      login({
        user_id: data.user_id,
        name: data.name,
        email: data.email
      }, data.access_token);

      // Navigate to chat page
      navigate('/chat');
    } catch (error) {
      console.error('Registration error:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <MdMedicalServices className="text-blue-500 text-5xl" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Create your MedBot account
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Or{' '}
          <Link to="/login" className="font-medium text-blue-600 hover:text-blue-500">
            sign in to your existing account
          </Link>
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {/* Progress bar */}
          <div className="mb-8">
            <div className="flex justify-between">
              <div className={`flex flex-col items-center ${currentStep >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
                <div className={`rounded-full h-8 w-8 flex items-center justify-center border-2 ${currentStep >= 1 ? 'border-blue-600 bg-blue-100' : 'border-gray-200'}`}>
                  <FiUser />
                </div>
                <span className="text-xs mt-1">Account</span>
              </div>
              <div className="flex-1 flex items-center">
                <div className={`h-1 flex-1 ${currentStep >= 2 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
              </div>
              <div className={`flex flex-col items-center ${currentStep >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
                <div className={`rounded-full h-8 w-8 flex items-center justify-center border-2 ${currentStep >= 2 ? 'border-blue-600 bg-blue-100' : 'border-gray-200'}`}>
                  <BiMaleFemale />
                </div>
                <span className="text-xs mt-1">Personal</span>
              </div>
              <div className="flex-1 flex items-center">
                <div className={`h-1 flex-1 ${currentStep >= 3 ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
              </div>
              <div className={`flex flex-col items-center ${currentStep >= 3 ? 'text-blue-600' : 'text-gray-400'}`}>
                <div className={`rounded-full h-8 w-8 flex items-center justify-center border-2 ${currentStep >= 3 ? 'border-blue-600 bg-blue-100' : 'border-gray-200'}`}>
                  <MdOutlineHealthAndSafety />
                </div>
                <span className="text-xs mt-1">Health</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-4 bg-red-50 border-l-4 border-red-500 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9a1 1 0 112 0v4a1 1 0 11-2 0V9z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-red-700">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          )}

          <form>
            {/* Step 1: Account Information */}
            {currentStep === 1 && (
              <div className="space-y-6">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                    Full Name
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiUser className="text-gray-400" />
                    </div>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      value={formData.name}
                      onChange={handleChange}
                      className={`block w-full pl-10 pr-3 py-2 border ${errors.name ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'} rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none sm:text-sm`}
                      placeholder="Enter your name"
                    />
                  </div>
                  {errors.name && (
                    <p className="mt-1 text-sm text-red-600">{errors.name}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    Email address
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiMail className="text-gray-400" />
                    </div>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      value={formData.email}
                      onChange={handleChange}
                      className={`block w-full pl-10 pr-3 py-2 border ${errors.email ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'} rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none sm:text-sm`}
                      placeholder="you@example.com"
                    />
                  </div>
                  {errors.email && (
                    <p className="mt-1 text-sm text-red-600">{errors.email}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiLock className="text-gray-400" />
                    </div>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      value={formData.password}
                      onChange={handleChange}
                      className={`block w-full pl-10 pr-3 py-2 border ${errors.password ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'} rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none sm:text-sm`}
                      placeholder="••••••••"
                    />
                  </div>
                  {errors.password ? (
                    <p className="mt-1 text-sm text-red-600">{errors.password}</p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500">
                      Password must be at least 8 characters and contain at least one capital letter, one number, and one special character.
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                    Confirm Password
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiLock className="text-gray-400" />
                    </div>
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      value={formData.confirmPassword}
                      onChange={handleChange}
                      className={`block w-full pl-10 pr-3 py-2 border ${errors.confirmPassword ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'} rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none sm:text-sm`}
                      placeholder="••••••••"
                    />
                  </div>
                  {errors.confirmPassword && (
                    <p className="mt-1 text-sm text-red-600">{errors.confirmPassword}</p>
                  )}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleNext}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Personal Information */}
            {currentStep === 2 && (
              <div className="space-y-6">
                <div>
                  <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-1">
                    Gender
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <div
                      className={`flex items-center p-3 border ${errors.gender ? 'border-red-500' : formData.gender === 'male' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'} rounded-md cursor-pointer hover:bg-gray-50`}
                      onClick={() => {
                        setFormData({ ...formData, gender: 'male' });
                        if (errors.gender) {
                          setErrors({ ...errors, gender: '' });
                        }
                      }}
                    >
                      <BiMaleFemale className={`${formData.gender === 'male' ? 'text-blue-500' : 'text-gray-400'} mr-2`} />
                      <span className={`${formData.gender === 'male' ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>Male</span>
                    </div>
                    <div
                      className={`flex items-center p-3 border ${errors.gender ? 'border-red-500' : formData.gender === 'female' ? 'border-blue-500 bg-blue-50' : 'border-gray-300'} rounded-md cursor-pointer hover:bg-gray-50`}
                      onClick={() => {
                        setFormData({ ...formData, gender: 'female' });
                        if (errors.gender) {
                          setErrors({ ...errors, gender: '' });
                        }
                      }}
                    >
                      <BiMaleFemale className={`${formData.gender === 'female' ? 'text-blue-500' : 'text-gray-400'} mr-2`} />
                      <span className={`${formData.gender === 'female' ? 'text-blue-700 font-medium' : 'text-gray-700'}`}>Female</span>
                    </div>
                  </div>
                  {errors.gender && (
                    <p className="mt-1 text-sm text-red-600">{errors.gender}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="age" className="block text-sm font-medium text-gray-700">
                    Age
                  </label>
                  <div className="mt-1 relative rounded-md shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <FiCalendar className="text-gray-400" />
                    </div>
                    <input
                      id="age"
                      name="age"
                      type="number"
                      min="1"
                      max="120"
                      value={formData.age}
                      onChange={handleChange}
                      className={`block w-full pl-10 pr-3 py-2 border ${errors.age ? 'border-red-500 focus:ring-red-500 focus:border-red-500' : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'} rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none sm:text-sm`}
                      placeholder="30"
                    />
                  </div>
                  {errors.age && (
                    <p className="mt-1 text-sm text-red-600">{errors.age}</p>
                  )}
                </div>

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleNext}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Health Information */}
            {currentStep === 3 && (
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <div className="flex items-center">
                      <RiHeartPulseLine className="text-blue-500 mr-2" />
                      Pre-existing Conditions
                    </div>
                  </label>
                  <div className="flex">
                    <input
                      type="text"
                      value={tempComorbidity}
                      onChange={(e) => setTempComorbidity(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-l-md px-3 py-2 text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., Diabetes, Hypertension"
                    />
                    <button
                      type="button"
                      onClick={addComorbidity}
                      className="bg-blue-600 text-white px-4 py-2 rounded-r-md hover:bg-blue-700 focus:outline-none"
                    >
                      Add
                    </button>
                  </div>
                  {formData.comorbidities.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {formData.comorbidities.map((item, index) => (
                        <div key={index} className="bg-blue-50 text-blue-700 rounded-full px-3 py-1 text-sm flex items-center">
                          {item}
                          <button
                            type="button"
                            onClick={() => removeComorbidity(index)}
                            className="ml-2 text-blue-500 hover:text-blue-800 focus:outline-none"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <div className="flex items-center">
                      <MdOutlineMedication className="text-blue-500 mr-2" />
                      Current Medications
                    </div>
                  </label>
                  <div className="flex">
                    <input
                      type="text"
                      value={tempMedication}
                      onChange={(e) => setTempMedication(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-l-md px-3 py-2 text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., Lisinopril, Metformin"
                    />
                    <button
                      type="button"
                      onClick={addMedication}
                      className="bg-blue-600 text-white px-4 py-2 rounded-r-md hover:bg-blue-700 focus:outline-none"
                    >
                      Add
                    </button>
                  </div>
                  {formData.medications.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {formData.medications.map((item, index) => (
                        <div key={index} className="bg-blue-50 text-blue-700 rounded-full px-3 py-1 text-sm flex items-center">
                          {item}
                          <button
                            type="button"
                            onClick={() => removeMedication(index)}
                            className="ml-2 text-blue-500 hover:text-blue-800 focus:outline-none"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <div className="flex items-center">
                      <GiMedicines className="text-blue-500 mr-2" />
                      Allergies
                    </div>
                  </label>
                  <div className="flex">
                    <input
                      type="text"
                      value={tempAllergy}
                      onChange={(e) => setTempAllergy(e.target.value)}
                      className="flex-1 border border-gray-300 rounded-l-md px-3 py-2 text-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g., Penicillin, Peanuts"
                    />
                    <button
                      type="button"
                      onClick={addAllergy}
                      className="bg-blue-600 text-white px-4 py-2 rounded-r-md hover:bg-blue-700 focus:outline-none"
                    >
                      Add
                    </button>
                  </div>
                  {formData.allergies.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {formData.allergies.map((item, index) => (
                        <div key={index} className="bg-blue-50 text-blue-700 rounded-full px-3 py-1 text-sm flex items-center">
                          {item}
                          <button
                            type="button"
                            onClick={() => removeAllergy(index)}
                            className="ml-2 text-blue-500 hover:text-blue-800 focus:outline-none"
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isLoading}
                    className={`inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white ${isLoading ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500`}
                  >
                    {isLoading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Creating Account...
                      </>
                    ) : (
                      <>
                        <FiUserPlus className="mr-2 -ml-1" />
                        Create Account
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage; 