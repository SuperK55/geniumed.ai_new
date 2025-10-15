#!/usr/bin/env node

import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3000';

// Test data
const testAdmin = {
  email: 'admin@test.com',
  password: 'password123',
  name: 'Test Admin',
  role: 'admin'
};

const testUser = {
  email: 'owner@test.com',
  password: 'password123',
  name: 'Test Owner',
  phone_number: '+1234567890',
  specialty: 'Cardiology',
  role: 'owner'
};

let authToken = '';

// Helper function to make authenticated requests
const apiRequest = async (endpoint, options = {}) => {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json();
  return { response, data };
};

// Test functions
const testSignIn = async () => {
  console.log('🔐 Testing admin sign in...');
  const { response, data } = await apiRequest('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({
      email: testAdmin.email,
      password: testAdmin.password
    })
  });

  if (response.ok && data.ok) {
    authToken = data.token;
    console.log('✅ Admin sign in successful');
    return true;
  } else {
    console.log('❌ Admin sign in failed:', data.error);
    return false;
  }
};

const testGetUsers = async () => {
  console.log('📋 Testing GET /api/users...');
  const { response, data } = await apiRequest('/api/users');

  if (response.ok && data.ok) {
    console.log(`✅ Get users successful - Found ${data.users.length} users`);
    return true;
  } else {
    console.log('❌ Get users failed:', data.error);
    return false;
  }
};

const testGetUserStats = async () => {
  console.log('📊 Testing GET /api/users/stats...');
  const { response, data } = await apiRequest('/api/users/stats');

  if (response.ok && data.ok) {
    console.log('✅ Get user stats successful:', data.stats);
    return true;
  } else {
    console.log('❌ Get user stats failed:', data.error);
    return false;
  }
};

const testCreateUser = async () => {
  console.log('👤 Testing POST /api/users...');
  const { response, data } = await apiRequest('/api/users', {
    method: 'POST',
    body: JSON.stringify(testUser)
  });

  if (response.ok && data.ok) {
    console.log('✅ Create user successful:', data.user.email);
    return data.user;
  } else {
    console.log('❌ Create user failed:', data.error);
    return null;
  }
};

const testUpdateUser = async (userId) => {
  console.log('✏️ Testing PATCH /api/users/:id...');
  const { response, data } = await apiRequest(`/api/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: 'Updated Owner Name',
      specialty: 'Neurology'
    })
  });

  if (response.ok && data.ok) {
    console.log('✅ Update user successful:', data.user.name);
    return true;
  } else {
    console.log('❌ Update user failed:', data.error);
    return false;
  }
};

const testToggleUserStatus = async (userId) => {
  console.log('🔄 Testing POST /api/users/:id/toggle-status...');
  const { response, data } = await apiRequest(`/api/users/${userId}/toggle-status`, {
    method: 'POST'
  });

  if (response.ok && data.ok) {
    console.log('✅ Toggle user status successful:', data.user.is_active);
    return true;
  } else {
    console.log('❌ Toggle user status failed:', data.error);
    return false;
  }
};

const testResetPassword = async (userId) => {
  console.log('🔑 Testing POST /api/users/:id/reset-password...');
  const { response, data } = await apiRequest(`/api/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({
      newPassword: 'newpassword123'
    })
  });

  if (response.ok && data.ok) {
    console.log('✅ Reset password successful');
    return true;
  } else {
    console.log('❌ Reset password failed:', data.error);
    return false;
  }
};

const testDeleteUser = async (userId) => {
  console.log('🗑️ Testing DELETE /api/users/:id...');
  const { response, data } = await apiRequest(`/api/users/${userId}`, {
    method: 'DELETE'
  });

  if (response.ok && data.ok) {
    console.log('✅ Delete user successful:', data.deletedUser.email);
    return true;
  } else {
    console.log('❌ Delete user failed:', data.error);
    return false;
  }
};

// Main test runner
const runTests = async () => {
  console.log('🚀 Starting User Management API Tests...\n');

  try {
    // Test 1: Sign in as admin
    const signInSuccess = await testSignIn();
    if (!signInSuccess) {
      console.log('❌ Cannot proceed without admin authentication');
      return;
    }

    console.log('');

    // Test 2: Get users
    await testGetUsers();
    console.log('');

    // Test 3: Get user stats
    await testGetUserStats();
    console.log('');

    // Test 4: Create user
    const createdUser = await testCreateUser();
    console.log('');

    if (createdUser) {
      // Test 5: Update user
      await testUpdateUser(createdUser.id);
      console.log('');

      // Test 6: Toggle user status
      await testToggleUserStatus(createdUser.id);
      console.log('');

      // Test 7: Reset password
      await testResetPassword(createdUser.id);
      console.log('');

      // Test 8: Delete user
      await testDeleteUser(createdUser.id);
      console.log('');
    }

    console.log('🎉 All tests completed!');

  } catch (error) {
    console.error('❌ Test runner error:', error);
  }
};

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

export { runTests };
