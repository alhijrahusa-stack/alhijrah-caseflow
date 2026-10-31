import {describe,expect,it} from 'vitest';
import {isEmploymentInterview} from './appointment-purpose';

describe('employment interview purpose',()=>{
  it.each(['Pre-hire appointment','Employment interview','  PRE_HIRE   APPOINTMENT ','مقابلة توظيف'])('classifies %s independently of a missed lifecycle checkbox',value=>{
    expect(isEmploymentInterview(value)).toBe(true);
  });
  it.each(['Office intake','Document check','I-9 appointment','Follow-up meeting'])('keeps %s independent',value=>{
    expect(isEmploymentInterview(value)).toBe(false);
  });
});
