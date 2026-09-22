#include <Arduino.h>
#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>

#define TFT_SCLK 18
#define TFT_MOSI 23
#define TFT_CS 5
#define TFT_DC 16
#define TFT_RST 17

#define LEFT_TURN_PIN 32
#define RIGHT_TURN_PIN 33

#define HUD_MIRROR true
#define EDGE_WIDTH 6
#define DATA_TIMEOUT_MS 5000

static const char* SERVICE_UUID="c6f50001-46bb-4bb5-a8dd-000000000001";
static const char* DATA_UUID="c6f50002-46bb-4bb5-a8dd-000000000001";

Adafruit_ST7789 tft(TFT_CS,TFT_DC,TFT_RST);

struct RGB{float r;float g;float b;};

const RGB RED={255,0,0};
const RGB ORANGE={255,133,0};
const RGB BLUE={0,140,255};
const RGB PURPLE={170,0,255};
const RGB WHITE={255,255,255};

volatile float rxSpeed=0.0f;
volatile int rxLimit=-1;
volatile uint32_t lastPacketMs=0;
portMUX_TYPE dataMux=portMUX_INITIALIZER_UNLOCKED;

RGB shownColor=WHITE;
int lastRenderedSpeed=-999;
bool timedOutLast=true;
bool lastLeft=false;
bool lastRight=false;

enum Segment:uint8_t{
  A=1<<0,B=1<<1,C=1<<2,D=1<<3,E=1<<4,F=1<<5,G=1<<6
};

const uint8_t DIGITS[10]={
  A|B|C|D|E|F,
  B|C,
  A|B|G|E|D,
  A|B|C|D|G,
  F|G|B|C,
  A|F|G|C|D,
  A|F|G|E|C|D,
  A|B|C,
  A|B|C|D|E|F|G,
  A|B|C|D|F|G
};

RGB mixColor(const RGB& a,const RGB& b,float t){
  t=constrain(t,0.0f,1.0f);
  return{
    a.r+(b.r-a.r)*t,
    a.g+(b.g-a.g)*t,
    a.b+(b.b-a.b)*t
  };
}

RGB targetColor(float speed,int limit){
  if(limit<=0)return WHITE;

  const float diff=speed-limit;

  if(diff>=10.0f)return RED;
  if(diff>5.0f)return mixColor(ORANGE,RED,(diff-5.0f)/5.0f);

  if(diff>-5.0f)return ORANGE;

  if(diff>-10.0f){
    return mixColor(BLUE,PURPLE,(-diff-5.0f)/5.0f);
  }

  return PURPLE;
}

uint16_t rgb565(const RGB& c){
  return tft.color565(
    (uint8_t)constrain(c.r,0.0f,255.0f),
    (uint8_t)constrain(c.g,0.0f,255.0f),
    (uint8_t)constrain(c.b,0.0f,255.0f)
  );
}

uint8_t mirrorSegments(uint8_t s){
  uint8_t out=0;
  if(s&A)out|=A;
  if(s&D)out|=D;
  if(s&G)out|=G;
  if(s&B)out|=F;
  if(s&F)out|=B;
  if(s&C)out|=E;
  if(s&E)out|=C;
  return out;
}

void drawDigit(int x,int y,int w,int h,int thick,int digit,uint16_t color,bool mirror){
  if(digit<0||digit>9)return;

  uint8_t s=DIGITS[digit];
  if(mirror)s=mirrorSegments(s);

  const int half=h/2;

  if(s&A)tft.fillRoundRect(x+thick,y,w-2*thick,thick,thick/2,color);
  if(s&G)tft.fillRoundRect(x+thick,y+half-thick/2,w-2*thick,thick,thick/2,color);
  if(s&D)tft.fillRoundRect(x+thick,y+h-thick,w-2*thick,thick,thick/2,color);

  if(s&F)tft.fillRoundRect(x,y+thick,thick,half-thick,thick/2,color);
  if(s&B)tft.fillRoundRect(x+w-thick,y+thick,thick,half-thick,thick/2,color);
  if(s&E)tft.fillRoundRect(x,y+half,thick,half-thick,thick/2,color);
  if(s&C)tft.fillRoundRect(x+w-thick,y+half,thick,half-thick,thick/2,color);
}

void clearCenter(){
  tft.fillRect(EDGE_WIDTH,0,tft.width()-EDGE_WIDTH*2,tft.height(),ST77XX_BLACK);
}

void drawDisconnected(){
  clearCenter();

  const int y=tft.height()/2-6;
  const int dashW=54;
  const int gap=18;
  const int start=(tft.width()-(dashW*2+gap))/2;
  const uint16_t gray=tft.color565(75,75,75);

  tft.fillRoundRect(start,y,dashW,12,5,gray);
  tft.fillRoundRect(start+dashW+gap,y,dashW,12,5,gray);

  lastRenderedSpeed=-999;
}

void drawSpeed(int mph,uint16_t color){
  mph=constrain(mph,0,180);
  String value=String(mph);

  const int count=value.length();
  const int digitW=count==3?72:82;
  const int digitH=154;
  const int thick=13;
  const int gap=10;
  const int total=count*digitW+(count-1)*gap;
  const int startX=(tft.width()-total)/2;
  const int y=(tft.height()-digitH)/2;

  for(int i=0;i<count;i++){
    const int sourceIndex=HUD_MIRROR?(count-1-i):i;
    const int digit=value[sourceIndex]-'0';

    drawDigit(
      startX+i*(digitW+gap),
      y,
      digitW,
      digitH,
      thick,
      digit,
      color,
      HUD_MIRROR
    );
  }
}

void updateTurnEdges(){
  const bool left=digitalRead(LEFT_TURN_PIN)==HIGH;
  const bool right=digitalRead(RIGHT_TURN_PIN)==HIGH;
  const uint16_t green=tft.color565(0,255,70);

  if(left!=lastLeft){
    tft.fillRect(0,0,EDGE_WIDTH,tft.height(),left?green:ST77XX_BLACK);
    lastLeft=left;
  }

  if(right!=lastRight){
    tft.fillRect(tft.width()-EDGE_WIDTH,0,EDGE_WIDTH,tft.height(),right?green:ST77XX_BLACK);
    lastRight=right;
  }
}

class ServerCallbacks:public BLEServerCallbacks{
  void onDisconnect(BLEServer* server) override{
    BLEDevice::startAdvertising();
  }
};

class DataCallbacks:public BLECharacteristicCallbacks{
  void onWrite(BLECharacteristic* characteristic) override{
    String incoming(characteristic->getValue().c_str());
    incoming.trim();

    const int comma=incoming.indexOf(',');
    if(comma<1)return;

    const float speed=incoming.substring(0,comma).toFloat();
    const int limit=incoming.substring(comma+1).toInt();

    if(!isfinite(speed)||speed<0.0f||speed>180.0f)return;
    if(limit!=-1&&(limit<5||limit>90))return;

    portENTER_CRITICAL(&dataMux);
    rxSpeed=speed;
    rxLimit=limit;
    lastPacketMs=millis();
    portEXIT_CRITICAL(&dataMux);
  }
};

void setupBle(){
  BLEDevice::init("Car HUD");

  BLEServer* server=BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service=server->createService(SERVICE_UUID);
  BLECharacteristic* data=service->createCharacteristic(
    DATA_UUID,
    BLECharacteristic::PROPERTY_WRITE|BLECharacteristic::PROPERTY_WRITE_NR
  );

  data->setCallbacks(new DataCallbacks());
  service->start();

  BLEAdvertising* advertising=BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void setup(){
  Serial.begin(115200);

  pinMode(LEFT_TURN_PIN,INPUT_PULLDOWN);
  pinMode(RIGHT_TURN_PIN,INPUT_PULLDOWN);

  SPI.begin(TFT_SCLK,-1,TFT_MOSI,TFT_CS);
  tft.init(240,320);
  tft.setRotation(1);
  tft.fillScreen(ST77XX_BLACK);

  drawDisconnected();
  updateTurnEdges();
  setupBle();
}

void loop(){
  float speed;
  int limit;
  uint32_t packetTime;

  portENTER_CRITICAL(&dataMux);
  speed=rxSpeed;
  limit=rxLimit;
  packetTime=lastPacketMs;
  portEXIT_CRITICAL(&dataMux);

  updateTurnEdges();

  const bool timedOut=packetTime==0||(millis()-packetTime>DATA_TIMEOUT_MS);

  if(timedOut){
    if(!timedOutLast)drawDisconnected();
    timedOutLast=true;
    delay(20);
    return;
  }

  timedOutLast=false;

  const RGB target=targetColor(speed,limit);
  const float fade=0.10f;

  shownColor.r+=(target.r-shownColor.r)*fade;
  shownColor.g+=(target.g-shownColor.g)*fade;
  shownColor.b+=(target.b-shownColor.b)*fade;

  const int shownSpeed=(int)lroundf(speed);

  if(shownSpeed!=lastRenderedSpeed){
    clearCenter();
    lastRenderedSpeed=shownSpeed;
  }

  drawSpeed(shownSpeed,rgb565(shownColor));
  delay(30);
}
