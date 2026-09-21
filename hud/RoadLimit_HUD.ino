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

static const char* SERVICE_UUID = "c6f50001-46bb-4bb5-a8dd-000000000001";
static const char* DATA_UUID = "c6f50002-46bb-4bb5-a8dd-000000000001";

Adafruit_ST7789 tft(TFT_CS, TFT_DC, TFT_RST);

struct RGB { float r; float g; float b; };

const RGB COLOR_RED = {255,0,0};
const RGB COLOR_ORANGE = {255,128,0};
const RGB COLOR_BLUE = {0,135,255};
const RGB COLOR_PURPLE = {170,0,255};
const RGB COLOR_WHITE = {255,255,255};

volatile float rxSpeedMph = 0.0f;
volatile int rxLimitMph = -1;
volatile uint32_t lastPacketMs = 0;
volatile bool bleConnected = false;

portMUX_TYPE dataMux = portMUX_INITIALIZER_UNLOCKED;

RGB shownColor = COLOR_WHITE;
int lastRenderedSpeed = -999;
bool lastTimedOut = true;
bool lastLeft = false;
bool lastRight = false;

enum Segment : uint8_t {
  SEG_A=1<<0, SEG_B=1<<1, SEG_C=1<<2, SEG_D=1<<3,
  SEG_E=1<<4, SEG_F=1<<5, SEG_G=1<<6
};

const uint8_t DIGIT_SEGMENTS[10] = {
  SEG_A|SEG_B|SEG_C|SEG_D|SEG_E|SEG_F,
  SEG_B|SEG_C,
  SEG_A|SEG_B|SEG_G|SEG_E|SEG_D,
  SEG_A|SEG_B|SEG_C|SEG_D|SEG_G,
  SEG_F|SEG_G|SEG_B|SEG_C,
  SEG_A|SEG_F|SEG_G|SEG_C|SEG_D,
  SEG_A|SEG_F|SEG_G|SEG_E|SEG_C|SEG_D,
  SEG_A|SEG_B|SEG_C,
  SEG_A|SEG_B|SEG_C|SEG_D|SEG_E|SEG_F|SEG_G,
  SEG_A|SEG_B|SEG_C|SEG_D|SEG_F|SEG_G
};

RGB mixColor(const RGB& a,const RGB& b,float amount){
  amount=constrain(amount,0.0f,1.0f);
  return {a.r+(b.r-a.r)*amount,a.g+(b.g-a.g)*amount,a.b+(b.b-a.b)*amount};
}

RGB targetColorFor(float speed,int limit){
  if(limit<=0)return COLOR_WHITE;
  const float diff=speed-limit;
  if(diff>=10.0f)return COLOR_RED;
  if(diff>5.0f)return mixColor(COLOR_ORANGE,COLOR_RED,(diff-5.0f)/5.0f);
  if(diff>-5.0f)return COLOR_ORANGE;
  if(diff>-10.0f)return mixColor(COLOR_BLUE,COLOR_PURPLE,(-diff-5.0f)/5.0f);
  return COLOR_PURPLE;
}

uint16_t to565(const RGB& c){
  return tft.color565(
    (uint8_t)constrain(c.r,0.0f,255.0f),
    (uint8_t)constrain(c.g,0.0f,255.0f),
    (uint8_t)constrain(c.b,0.0f,255.0f)
  );
}

uint8_t mirrorSegments(uint8_t s){
  uint8_t out=0;
  if(s&SEG_A)out|=SEG_A;
  if(s&SEG_D)out|=SEG_D;
  if(s&SEG_G)out|=SEG_G;
  if(s&SEG_B)out|=SEG_F;
  if(s&SEG_F)out|=SEG_B;
  if(s&SEG_C)out|=SEG_E;
  if(s&SEG_E)out|=SEG_C;
  return out;
}

void drawDigit(int x,int y,int w,int h,int thick,int digit,uint16_t color,bool preMirror){
  if(digit<0||digit>9)return;
  uint8_t s=DIGIT_SEGMENTS[digit];
  if(preMirror)s=mirrorSegments(s);
  const int half=h/2;
  if(s&SEG_A)tft.fillRoundRect(x+thick,y,w-2*thick,thick,thick/2,color);
  if(s&SEG_G)tft.fillRoundRect(x+thick,y+half-thick/2,w-2*thick,thick,thick/2,color);
  if(s&SEG_D)tft.fillRoundRect(x+thick,y+h-thick,w-2*thick,thick,thick/2,color);
  if(s&SEG_F)tft.fillRoundRect(x,y+thick,thick,half-thick,thick/2,color);
  if(s&SEG_B)tft.fillRoundRect(x+w-thick,y+thick,thick,half-thick,thick/2,color);
  if(s&SEG_E)tft.fillRoundRect(x,y+half,thick,half-thick,thick/2,color);
  if(s&SEG_C)tft.fillRoundRect(x+w-thick,y+half,thick,half-thick,thick/2,color);
}

void clearSpeedArea(){
  tft.fillRect(EDGE_WIDTH,0,tft.width()-EDGE_WIDTH*2,tft.height(),ST77XX_BLACK);
}

void drawDisconnected(){
  clearSpeedArea();
  const int y=tft.height()/2-6;
  const int dashW=54;
  const int gap=18;
  const int startX=(tft.width()-(dashW*2+gap))/2;
  uint16_t c=tft.color565(80,80,80);
  tft.fillRoundRect(startX,y,dashW,12,5,c);
  tft.fillRoundRect(startX+dashW+gap,y,dashW,12,5,c);
  lastRenderedSpeed=-999;
}

void drawSpeed(int mph,uint16_t color){
  mph=constrain(mph,0,180);
  String s=String(mph);
  const int count=s.length();
  const int digitW=count==3?72:82;
  const int digitH=154;
  const int thick=13;
  const int gap=10;
  const int totalW=count*digitW+(count-1)*gap;
  const int startX=(tft.width()-totalW)/2;
  const int y=(tft.height()-digitH)/2;

  for(int i=0;i<count;i++){
    int sourceIndex=HUD_MIRROR?(count-1-i):i;
    int digit=s[sourceIndex]-'0';
    drawDigit(startX+i*(digitW+gap),y,digitW,digitH,thick,digit,color,HUD_MIRROR);
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
  void onConnect(BLEServer* server) override{bleConnected=true;}
  void onDisconnect(BLEServer* server) override{
    bleConnected=false;
    BLEDevice::startAdvertising();
  }
};

class DataCallbacks:public BLECharacteristicCallbacks{
  void onWrite(BLECharacteristic* characteristic) override{
    String incoming=characteristic->getValue();
    incoming.trim();
    const int comma=incoming.indexOf(',');
    if(comma<1)return;

    const float speed=incoming.substring(0,comma).toFloat();
    const int limit=incoming.substring(comma+1).toInt();

    if(!isfinite(speed)||speed<0.0f||speed>180.0f)return;
    if(limit!=-1&&(limit<5||limit>90))return;

    portENTER_CRITICAL(&dataMux);
    rxSpeedMph=speed;
    rxLimitMph=limit;
    lastPacketMs=millis();
    portEXIT_CRITICAL(&dataMux);
  }
};

void setupBLE(){
  BLEDevice::init("RoadLimit HUD");
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
  setupBLE();
}

void loop(){
  float speed;
  int limit;
  uint32_t packetTime;

  portENTER_CRITICAL(&dataMux);
  speed=rxSpeedMph;
  limit=rxLimitMph;
  packetTime=lastPacketMs;
  portEXIT_CRITICAL(&dataMux);

  const bool timedOut=packetTime==0||(millis()-packetTime>DATA_TIMEOUT_MS);

  updateTurnEdges();

  if(timedOut){
    if(!lastTimedOut)drawDisconnected();
    lastTimedOut=true;
    delay(20);
    return;
  }

  lastTimedOut=false;
  RGB target=targetColorFor(speed,limit);
  const float alpha=0.10f;
  shownColor.r+=(target.r-shownColor.r)*alpha;
  shownColor.g+=(target.g-shownColor.g)*alpha;
  shownColor.b+=(target.b-shownColor.b)*alpha;

  const int shownSpeed=(int)lroundf(speed);
  if(shownSpeed!=lastRenderedSpeed){
    clearSpeedArea();
    lastRenderedSpeed=shownSpeed;
  }

  drawSpeed(shownSpeed,to565(shownColor));
  delay(30);
}
