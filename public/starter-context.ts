/** Bounded app-owned conversation guidance. Never derived from participant or brand text. */
export function starterOpening(id:string,hasReference:boolean){
 if(!hasReference)return {question:'What would you like to make?',choices:['A useful calculator','A guide to explain something','Help with an everyday task']};
 switch(id){
  case 'bitcoin-will':return {question:'Who would this guide help?',choices:['Me','My family','Workshop beginners']};
  case 'inflation':return {question:'What would you like to explore?',choices:['Try a hypothetical $10,000','Compare 5 and 10 years','Explore a 3% inflation scenario']};
  case 'hair':return {question:'What services would you like to price?',choices:['Cuts and finishes','Colour services','Styling and extras']};
  case 'retirement':return {question:'What would you like to explore in this planner?',choices:['The time horizon','The sample assumptions','Who it could help']};
  default:return {question:'What would you like this example to help with?',choices:['Explain it simply','Explore the sample','Choose an audience']};
 }
}
