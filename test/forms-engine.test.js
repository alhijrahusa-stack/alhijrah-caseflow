import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeAiTool,blankAudit,compareFormAnswers,formReadiness,participantMatch,routeAsylumAuthority,routePassport,validateVersionActivation} from '../src/forms-engine.js';

test('participant matching uses exact identifiers and forces a human decision',()=>{
  const matches=participantMatch({legal_name:'Amina Yusuf',date_of_birth:'1990-01-02',passport_number:'P123'},[{id:'p1',legal_name:'Amina Yusuf',date_of_birth:'1990-01-02',passport_number:'P123'}]);
  assert.deepEqual(matches[0].reasons.sort(),['NAME_DOB_EXACT','PASSPORT_EXACT']);
});

test('passport and asylum routers explain fact-based authority decisions',()=>{
  assert.deepEqual(routePassport({applicant_age:35,first_passport:false,previous_passport_in_possession:true,previous_passport_issued_age:20,previous_passport_issued_within_15_years:true}).forms,['DS-82']);
  assert.deepEqual(routePassport({applicant_age:12,both_parents_appearing:false,non_appearing_parent_can_consent:true}).forms,['DS-11','DS-3053']);
  assert.equal(routeAsylumAuthority({in_removal_proceedings:true}).authority,'EOIR');
  assert.equal(routeAsylumAuthority({in_removal_proceedings:false,seeking_affirmative_asylum:true}).authority,'USCIS');
  assert.equal(routeAsylumAuthority({}).authority,null);
});

test('blank, cross-form, version and AI tool controls fail closed',()=>{
  const definition={fields:[{path:'name',canonical_field_path:'person.name',official_label:'Name',part:'1',item_number:'1',required:true},{path:'other',canonical_field_path:'person.other',official_label:'Other',part:'1',item_number:'2',mapping_status:'unmapped'}]};
  assert.equal(blankAudit(definition,{}).length,2);
  assert.equal(compareFormAnswers([{form_code:'A',answers:[{canonical_field_path:'person.name',value:'X'}]},{form_code:'B',answers:[{canonical_field_path:'person.name',value:'Y'}]}])[0].severity,'blocker');
  assert.equal(validateVersionActivation({edition_date:'x'},definition).allowed,false);
  assert.equal(formReadiness({definition,answers:{},version:{}}).filing_ready,false);
  assert.equal(authorizeAiTool('delete_case',{id:'u'},'c').allowed,false);
});
