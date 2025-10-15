#!/usr/bin/env node

import { supa } from './src/lib/supabase.js';

const checkSpecialtyConstraint = async () => {
  console.log('🔍 Checking specialty constraint...\n');

  try {
    // Try to insert invalid specialty
    console.log('Testing invalid specialty insertion...');
    const { data, error } = await supa
      .from('users')
      .insert({
        email: 'invalid-specialty@example.com',
        password: 'test-hash',
        name: 'Invalid Specialty User',
        specialty: 'invalid_specialty'
      })
      .select()
      .single();

    if (error) {
      console.log('✅ Invalid specialty correctly rejected:', error.message);
    } else {
      console.log('❌ Invalid specialty was accepted!');
      console.log('   Created user:', data.name, 'with specialty:', data.specialty);
      
      // Clean up
      await supa.from('users').delete().eq('id', data.id);
      console.log('   Test user cleaned up');
    }

    // Check what specialties exist in the database
    console.log('\n📋 Checking existing specialties...');
    const { data: users, error: usersError } = await supa
      .from('users')
      .select('name, specialty')
      .not('specialty', 'is', null);

    if (usersError) {
      console.log('❌ Error fetching users:', usersError.message);
    } else {
      console.log('Current specialties in database:');
      users.forEach(user => {
        console.log(`  - ${user.name}: ${user.specialty}`);
      });
    }

  } catch (error) {
    console.error('❌ Check error:', error);
  }
};

checkSpecialtyConstraint();
