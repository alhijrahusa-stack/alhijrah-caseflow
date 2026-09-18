import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName} from 'pdf-lib';
import {generateControlledOfficeDocument,inspectPdfCapabilities,populateOfficialPdf} from '../src/forms-engine.js';

test('official PDF population maps, verifies round-trip, and never truncates silently',async()=>{
  const source=await PDFDocument.create(),page=source.addPage();source.getForm().createTextField('name').addToPage(page);source.getForm().createTextField('continuation').addToPage(page);const bytes=await source.save();
  const capabilities=await inspectPdfCapabilities(bytes);assert.equal(capabilities.acroform,true);assert.equal(capabilities.xfa,false);assert.equal(capabilities.static,false);
  const result=await populateOfficialPdf({sourceBytes:bytes,mapping:[{pdf_field:'name',canonical_field_path:'person.name',max_length:5,overflow_rule:{type:'additional_information',continuation_pdf_field:'continuation',reference_text:'See addendum'}}],canonicalData:{'person.name':'Amina Yusuf'}});
  assert.equal(result.round_trip_passed,true);assert.equal(result.overflows.length,1);assert.equal(result.sha256.length,64);
  await assert.rejects(()=>populateOfficialPdf({sourceBytes:bytes,mapping:[{pdf_field:'name',canonical_field_path:'person.name',max_length:3}],canonicalData:{'person.name':'Long'}}),/PDF_FIELD_OVERFLOW_REVIEW_REQUIRED/);
});

test('PDF capability inspection detects XFA instead of misclassifying it as static',async()=>{
  const source=await PDFDocument.create();source.addPage();const acroForm=source.context.obj({XFA:'xfa-packet'});source.catalog.set(PDFName.of('AcroForm'),acroForm);const bytes=await source.save({useObjectStreams:false});
  const capabilities=await inspectPdfCapabilities(bytes);
  assert.equal(capabilities.acroform,true);
  assert.equal(capabilities.xfa,true);
  assert.equal(capabilities.static,false);
});

test('office documents are labeled non-official and require controlled types',async()=>{
  const result=await generateControlledOfficeDocument({documentType:'GENERAL_AUTHORIZATION_POA',title:'Authorization',jurisdiction:'Virginia',purpose:'Limited records request',sections:[{heading:'Scope',paragraphs:['Limited authority only.']}]});
  assert.equal(result.official,false);assert.ok(result.bytes.length>500);
});
