#!/usr/bin/env node

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8080';

// Test user creation with specialty
const testUserCreation = async () => {
  console.log('🧪 Testing user creation with specialty field...\n');

  try {
    // Test 1: Create user with valid specialty
    console.log('1. Testing valid specialty (clinic)...');
    const response1 = await fetch(`${BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test-clinic@example.com',
        password: 'password123',
        name: 'Test Clinic User',
        phone_number: '+1234567890',
        specialty: 'clinic',
        role: 'owner'
      })
    });

    const data1 = await response1.json();
    if (response1.ok && data1.ok) {
      console.log('✅ Valid specialty test passed');
      console.log(`   Created user: ${data1.user.name} (${data1.user.specialty})`);
    } else {
      console.log('❌ Valid specialty test failed:', data1.error);
    }

    console.log('');

    // Test 2: Create user with another valid specialty
    console.log('2. Testing another valid specialty (real_estate)...');
    const response2 = await fetch(`${BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test-realestate@example.com',
        password: 'password123',
        name: 'Test Real Estate User',
        phone_number: '+1234567891',
        specialty: 'real_estate',
        role: 'owner'
      })
    });

    const data2 = await response2.json();
    if (response2.ok && data2.ok) {
      console.log('✅ Real estate specialty test passed');
      console.log(`   Created user: ${data2.user.name} (${data2.user.specialty})`);
    } else {
      console.log('❌ Real estate specialty test failed:', data2.error);
    }

    console.log('');

    // Test 3: Try to create user with invalid specialty
    console.log('3. Testing invalid specialty (should fail)...');
    const response3 = await fetch(`${BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'test-invalid@example.com',
        password: 'password123',
        name: 'Test Invalid User',
        specialty: 'invalid_specialty',
        role: 'owner'
      })
    });

    const data3 = await response3.json();
    if (!response3.ok && data3.error) {
      console.log('✅ Invalid specialty correctly rejected');
      console.log(`   Error: ${data3.error}`);
    } else {
      console.log('❌ Invalid specialty was not rejected');
    }

    console.log('\n🎉 Specialty field tests completed!');

  } catch (error) {
    console.error('❌ Test error:', error);
  }
};

// Run the test
testUserCreation();
