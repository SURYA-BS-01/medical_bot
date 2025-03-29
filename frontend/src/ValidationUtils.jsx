import { useState } from 'react';

// Validation patterns
export const VALIDATION_PATTERNS = {
  // Email regex pattern for basic validation
  EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  // Password must be at least 8 characters with at least one lowercase, one uppercase, one number, and one special character
  PASSWORD: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
  // Name should have at least 2 characters and contain only letters, spaces, hyphens and apostrophes
  NAME: /^[a-zA-Z\s'-]{2,}$/,
  // Age should be a positive number between 1 and 120
  AGE: /^(?:[1-9]|[1-9][0-9]|1[0-1][0-9]|120)$/
};

// Hook for form validation
export const useFormValidation = (initialValues, validationRules) => {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  // Function to handle input changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setValues({
      ...values,
      [name]: value
    });

    // Validate on change if the field has been touched
    if (touched[name]) {
      validateField(name, value);
    }
  };

  // Function to validate a single field
  const validateField = (name, value) => {
    // Skip validation if no rules for this field
    if (!validationRules[name]) return true;

    let fieldErrors = [];
    const rules = validationRules[name];

    // Check if required
    if (rules.required && (!value || value.length === 0)) {
      fieldErrors.push(`${rules.label || name} is required`);
    }

    // Check pattern match
    if (rules.pattern && value && !rules.pattern.test(value)) {
      fieldErrors.push(rules.message || `Invalid ${rules.label || name} format`);
    }

    // Check min length
    if (rules.minLength && value && value.length < rules.minLength) {
      fieldErrors.push(`${rules.label || name} should be at least ${rules.minLength} characters`);
    }

    // Check max length
    if (rules.maxLength && value && value.length > rules.maxLength) {
      fieldErrors.push(`${rules.label || name} should be at most ${rules.maxLength} characters`);
    }

    // Check equals (e.g., for password confirmation)
    if (rules.equals && value !== values[rules.equals]) {
      fieldErrors.push(`${rules.label || name} does not match ${rules.equalsLabel || rules.equals}`);
    }

    // Custom validation
    if (rules.custom && !rules.custom(value)) {
      fieldErrors.push(rules.customMessage || `Invalid ${rules.label || name}`);
    }

    // Update errors state
    setErrors(prev => ({
      ...prev,
      [name]: fieldErrors.length > 0 ? fieldErrors : null
    }));

    return fieldErrors.length === 0;
  };

  // Function to handle blur event (mark field as touched)
  const handleBlur = (e) => {
    const { name, value } = e.target;
    setTouched(prev => ({
      ...prev,
      [name]: true
    }));
    validateField(name, value);
  };

  // Function to validate all form fields
  const validateForm = () => {
    let formIsValid = true;
    let newErrors = {};

    // Validate each field
    Object.keys(validationRules).forEach(name => {
      const isValid = validateField(name, values[name]);
      if (!isValid) {
        formIsValid = false;
        newErrors[name] = errors[name];
      }
      // Mark all fields as touched
      setTouched(prev => ({
        ...prev,
        [name]: true
      }));
    });

    setErrors(newErrors);
    return formIsValid;
  };

  return {
    values,
    errors,
    touched,
    handleChange,
    handleBlur,
    validateForm,
    setValues,
    setErrors,
    setTouched
  };
};

// Error message component
export const FormErrorMessage = ({ error }) => {
  if (!error) return null;
  
  return (
    <div className="mt-1 text-sm text-red-600">
      {Array.isArray(error) ? error[0] : error}
    </div>
  );
}; 