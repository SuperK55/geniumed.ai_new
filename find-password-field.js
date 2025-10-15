#!/usr/bin/env node

import { supa } from './src/lib/supabase.js';

const findCorrectFieldName = async () => {
  console.log('🔍 Finding correct password field name...\n');

  const fieldNames = ['password', 'password_hash', 'hashed_password', 'pwd_hash'];
  
  for (const fieldName of fieldNames) {
    console.log(`Testing field: ${fieldName}`);
    
    const testData = {
      email: `test-${fieldName}@example.com`,
      [fieldName]: 'test-hash',
      name: 'Test User'
    };

    const { data, error } = await supa
      .from('users')
      .insert(testData)
      .select()
      .single();

    if (error) {
      console.log(`  ❌ ${fieldName}: ${error.message}`);
    } else {
      console.log(`  ✅ ${fieldName}: SUCCESS!`);
      console.log(`     Created user: ${data.name}`);
      
      // Clean up
      await supa.from('users').delete().eq('id', data.id);
      console.log(`     Cleaned up test user`);
      break;
    }
  }
};

findCorrectFieldName();
