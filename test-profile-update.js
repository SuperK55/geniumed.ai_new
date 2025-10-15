#!/usr/bin/env node

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:8080';

const testProfileUpdate = async () => {
  console.log('🧪 Testing profile update without specialty field...\n');

  try {
    // First, create a test user
    console.log('1. Creating test user...');
    const signupResponse = await fetch(`${BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'profile-test@example.com',
        password: 'password123',
        name: 'Profile Test User',
        specialty: 'clinic',
        role: 'owner'
      })
    });

    const signupData = await signupResponse.json();
    if (!signupResponse.ok || !signupData.ok) {
      console.log('❌ Failed to create test user:', signupData.error);
      return;
    }

    console.log('✅ Test user created:', signupData.user.name);
    const authToken = signupData.token;

    // Test profile update without specialty
    console.log('\n2. Testing profile update without specialty...');
    const updateResponse = await fetch(`${BASE_URL}/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name: 'Updated Profile Name',
        social_proof_enabled: true,
        social_proof_text: 'Test social proof text'
        // Note: specialty is NOT included
      })
    });

    const updateData = await updateResponse.json();
    if (updateResponse.ok && updateData.ok) {
      console.log('✅ Profile update successful');
      console.log(`   Updated name: ${updateData.user.name}`);
      console.log(`   Specialty preserved: ${updateData.user.specialty}`);
      console.log(`   Social proof enabled: ${updateData.user.social_proof_enabled}`);
    } else {
      console.log('❌ Profile update failed:', updateData.error);
    }

    // Test trying to update specialty (should be ignored)
    console.log('\n3. Testing specialty update attempt (should be ignored)...');
    const specialtyUpdateResponse = await fetch(`${BASE_URL}/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name: 'Another Update',
        specialty: 'real_estate'  // This should be ignored
      })
    });

    const specialtyUpdateData = await specialtyUpdateResponse.json();
    if (specialtyUpdateResponse.ok && specialtyUpdateData.ok) {
      console.log('✅ Specialty update attempt handled');
      console.log(`   Name updated: ${specialtyUpdateData.user.name}`);
      console.log(`   Specialty unchanged: ${specialtyUpdateData.user.specialty}`);
    } else {
      console.log('❌ Specialty update test failed:', specialtyUpdateData.error);
    }

    console.log('\n🎉 Profile update tests completed!');

  } catch (error) {
    console.error('❌ Test error:', error);
  }
};

// Run the test
testProfileUpdate();
